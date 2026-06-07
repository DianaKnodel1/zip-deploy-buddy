# Landing-Modul + Härtung — Plan

## 1. Theme-Bereinigung & neue Vorlagen

**Behalten:** `theme-10` (Design Studio Core — Gold Executive)

**Löschen:** theme-02, 03, 04, 05, 06, 07, 08, 09 (Ordner + Imports in `src/lib/landing-themes.ts`)

**Neu hinzufügen (je Ordner mit `meta.json`, `template.html`, `style.css`, `script.js`):**

- **`theme-tts-consultant`** — Replica von TTS Consultant (klassischer Beratungs-Look: Navy/Weiß, Hero mit Berater-Portrait rechts, Trust-Logos-Strip, 4-Spalten-Leistungen, Prozess-Timeline, Testimonials, FAQ-Accordion, vollständiger Footer mit Impressum-Block).
- **`theme-privacy-guardian`** — Replica von Privacy Guardian (Datenschutz-/Compliance-Vibe: weißer Hero mit grünem/blauem Akzent, Schild-Icon-Hero, Feature-Cards mit Häkchen-Listen, "So funktioniert's"-Steps, Pricing-Tabelle optional, DSGVO-Trust-Section, Footer).

Jedes Theme bekommt im `meta.json` ein vollständiges `slots`-Array (siehe Punkt 2) mit allen sichtbaren Textbausteinen — Hero-Titel, -Subtitel, Chips, CTAs, jede Section-Headline + Body, Footer-Claims, FAQ-Fragen/Antworten.

## 2. Theme-Editor mit Textbausteinen (Slots-System)

Aktuell existiert `meta.json.slots` bereits (siehe theme-02), wird aber im UI nicht editierbar dargestellt. Ausbau:

- **Alle 3 Themes** bekommen vollständige Slot-Definitionen für jeden sichtbaren Text (nicht nur Hero). Slot-Typen: `text`, `longtext` (Textarea), `image` (Data-URL), `color`.
- **In `src/routes/admin.landing-generator.tsx`:** Nach Theme-Auswahl rechts neben dem Branding-Formular einen Tab "Texte bearbeiten" einblenden. Pro Slot ein Eingabefeld (gruppiert nach Section: Hero / Leistungen / Prozess / FAQ / Footer). Default-Werte aus `meta.json.slots[].default` vorausgefüllt; Reset-Button pro Slot.
- **Live-Vorschau:** der vorhandene `<iframe>`-Preview rendert bei jeder Slot-Änderung neu (debounce 400 ms) — slots werden in den `generateLandingZip`-Call mitgegeben (Server-Function akzeptiert sie bereits).
- **Speichern pro Tenant** (optional Stage 2): JSON-Snapshot in `tenants.landing_slots` jsonb-Spalte, damit Änderungen über Sessions hinweg persistieren.

## 3. Tenant-Isolation Audit (E-Mails)

Code-Review-Aufgabe, kein neues Feature — nur Verifikation + Fixes wo nötig:

- **send-reminders/index.ts**: Empfänger werden aus `applications` / `profiles` geladen, jeder Datensatz hat `tenant_id`. Tenant wird daraus aufgelöst → SMTP, Sender, Portal-Link stammen aus dem **eigenen** Tenant. ✔ Bereits korrekt (siehe Code).
- **send-password-reset / send-signup-confirmation**: prüfen, dass `tenant_id` aus dem User-Record gezogen wird (nicht aus Request-Body, der manipulierbar wäre).
- **Recovery-Mail Portal-Link**: in `reminder_recovery_body` muss `{{portal_link}}` zwingend aus `tenant.primary_domain` oder `tenant.domain` des **gleichen** Tenants gebaut werden — niemals Cross-Tenant-Fallback. Audit + ggf. Hard-Assertion + Log.
- **Banner im Admin-UI**: in `/admin/tenants` Edit-Dialog ein Hinweis, wenn `sender_email`-Domain nicht zu `domain` / `primary_domain` / `domain_aliases` passt (verhindert versehentliche Cross-Tenant-Konfiguration).

## 4. Bounce/Soft-Fail Auto-Suppression

Neue Migration `supabase/manual-migrations/20260608000000_bounce_suppression.sql`:

```text
- ALTER TABLE suppressed_emails: stelle sicher (tenant_id, email) UNIQUE
- Trigger auf email_send_log AFTER INSERT:
    wenn NEW.status IN ('bounced','failed') mit SMTP-Code >= 500:
      count = (select count(*) from email_send_log
               where recipient_email = NEW.recipient_email
                 and status in ('bounced','failed')
                 and created_at > now() - interval '30 days')
      wenn count >= 3:
        INSERT INTO suppressed_emails (tenant_id, email, reason, source)
        VALUES (..., NEW.recipient_email, 'auto:3x_bounce', 'trigger')
        ON CONFLICT DO NOTHING
```

**Send-Pfad-Härtung** (send-reminders, send-password-reset, send-signup-confirmation): vor jedem Versand `select 1 from suppressed_emails where email = ? and tenant_id = ?` — wenn vorhanden, skip + log `suppressed`.

**Admin-UI** (`admin.email-logs.tsx`): existierender `BounceSuppressionPanel` zeigt bereits Liste + Unblock. Ergänzen: Spalte „Auto-gesperrt nach 3 Bounces" (Quelle = `auto:3x_bounce`).

## 5. Domain-Wechsel-Wizard

**Heutiger Stand (umständlich):** Admin geht in `/admin/tenants` → Edit-Dialog → fügt neue Domain in `domain_aliases` array ein → setzt `primary_domain` auf neue Domain → speichert. Dabei muss er `domain_aliases` als JSON-Array korrekt pflegen und darf die alte Domain nicht löschen. Fehleranfällig.

**Wizard (3 Klicks):** neuer Button „Domain wechseln" in `/admin/tenants` öffnet Modal:

1. **Schritt 1 — Neue Domain eingeben:** Input für neue Domain (z. B. `digital-dgigmbh.com`). Live-Check: ist die Domain im Tenant-Workspace bereits aktiv (DNS-Validierung optional)?
2. **Schritt 2 — Bestätigung:** Zeigt Vorher/Nachher:
   - `primary_domain`: `digital-dgigmbh.de` → **`digital-dgigmbh.com`**
   - `domain_aliases`: `[]` → **`["digital-dgigmbh.de"]`** (alte automatisch als Alias)
   - Hinweis: „Alte Mails an `…@digital-dgigmbh.de` werden weiterhin akzeptiert, neue Mails kommen von `…@digital-dgigmbh.com`. Recovery-Mail wird an akzeptierte Bewerber/Mitarbeiter versendet."
3. **Schritt 3 — Aktivieren:** Button „Wechsel durchführen" → 1 Server-Function `switchPrimaryDomain({tenantId, newDomain})` macht atomar:
   - `primary_domain = newDomain`
   - `domain_aliases = array_append(domain_aliases, alte_primary)` (deduped)
   - `primary_domain_changed_at = now()`
   - triggert Recovery-Mail-Lauf (`send-reminders` mode=`domain_recovery`)

**Vereinfachung:** Admin muss `domain_aliases` JSON nie wieder manuell editieren. Die manuelle Bearbeitung bleibt im erweiterten Edit-Dialog für Edge-Cases verfügbar.

## Reihenfolge

1. Themes bereinigen + TTS + Privacy Guardian bauen (mit vollen Slots)
2. Theme-Editor-UI (Slot-Felder + Live-Preview-Update)
3. Bounce-Suppression Migration + Send-Pfad-Checks
4. Tenant-Isolation Audit + Banner-Verschärfung
5. Domain-Wechsel-Wizard

## Geänderte/neue Dateien

- `src/landing-themes/theme-02..09/` — **gelöscht**
- `src/landing-themes/theme-tts-consultant/` — **neu** (4 Dateien)
- `src/landing-themes/theme-privacy-guardian/` — **neu** (4 Dateien)
- `src/landing-themes/theme-10/meta.json` — slots erweitern
- `src/lib/landing-themes.ts` — Imports anpassen
- `src/routes/admin.landing-generator.tsx` — Slot-Editor + Live-Preview-Wiring
- `supabase/manual-migrations/20260608000000_bounce_suppression.sql` — **neu**
- `supabase/functions/send-reminders/index.ts` — Suppression-Check vor Send
- `supabase/functions/send-password-reset/index.ts` — Tenant-Lookup absichern
- `supabase/functions/send-signup-confirmation/index.ts` — dito
- `src/routes/admin.tenants.tsx` — Wizard-Button + Modal + Sender-Domain-Banner
- `src/lib/tenant-domains.functions.ts` — neue `switchPrimaryDomain` server fn

Soll ich loslegen?
