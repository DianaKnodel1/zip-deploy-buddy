## Ziel

1. **Recovery vereinfachen**: nur 1 Template (Mitarbeiter), Bewerber komplett raus. Recovery-Empfänger automatisch auf „stille" Mitarbeiter (ohne aktiven Reminder-Flow) einschränken — wer eh bald einen Reminder kriegt, kriegt keine zusätzliche Recovery-Mail.
2. **Domain-Onboarding 1-Klick**: Neue Domain anbinden ohne SSH (Caddy Wildcard + Cloudflare-DNS-01).
3. **Hard-Bounce-Handling**: 5.x.x-Bounces markieren Empfänger als `inactive` und werden bei Retries übersprungen.

---

## 1. Recovery-Cleanup

**Code-Änderungen:**
- `getRecoveryPreview` (in `tenant-domains.functions.ts`): Bewerber-Render-Pfad entfernen, nur `mitarbeiter` zurückgeben. Legacy-Felder (`subject`/`html`/`portal_link`) bleiben für Abwärtskompat.
- `getAffectedRecipients`: Bewerber-Block (`kind: "bewerber_akzeptiert"`) ganz raus. Außerdem Mitarbeiter weiter filtern: nur die, die **keinen aktiven Reminder-Trigger** in den nächsten 7 Tagen haben (keine offenen Tasks mit Deadline, kein anstehender Termin, kein offenes Onboarding) — Detail-Logik definiere ich beim Bauen.
- `send-reminders/index.ts`: Bewerber-Recovery-Branch entfernen, Spalten `reminder_recovery_bewerber_*` nicht mehr lesen.
- `/admin/email-templates`: „Domain-Wechsel"-Tab zurück auf **einen** Editor (Mitarbeiter), Sub-Tabs raus.
- `/admin/recovery`: Vorschau-Tabs raus, nur Mitarbeiter-Preview.
- Migration `20260606200000_recovery_template_split.sql`: bleibt liegen (Spalten machen nichts kaputt), oder wir droppen sie sauber — entscheide ich beim Bauen, je nachdem ob sie schon auf VPS gelaufen ist.

**Recovery-Definition wird:** „Einmaliger Broadcast nach `primary_domain_changed_at` an aktive Mitarbeiter, die im normalen Reminder-Flow nicht in den nächsten 7 Tagen angeschrieben würden."

---

## 2. Domain-Onboarding 1-Klick (mit Cloudflare)

Da alle Domains hinter Cloudflare-Proxy laufen, geht Let's Encrypt HTTP-01 nicht. Lösung: **Caddy mit DNS-01 via Cloudflare-API**.

**Setup (einmalig, manuell):**
- Cloudflare API-Token erzeugen mit Scope `Zone:DNS:Edit` für alle relevanten Zonen.
- Token als Secret `CLOUDFLARE_API_TOKEN` in Lovable Cloud speichern + auf VPS in Caddy-Env.
- Caddy-Build mit `caddy-dns/cloudflare`-Plugin (xcaddy).
- Caddyfile auf Wildcard + on-demand-TLS + Ask-Endpoint umstellen:

```text
{
  on_demand_tls {
    ask https://portal.<root-domain>/api/public/caddy-ask
  }
}

*.* {
  tls {
    dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    on_demand
  }
  reverse_proxy 127.0.0.1:3000
}
```

**Neu im Code:**
- `src/routes/api/public/caddy-ask.ts`: `GET ?domain=portal.foo.com` → 200 wenn `foo.com` (ohne `portal.`-Präfix) in `tenants.domain` oder `domain_aliases` einer aktiven Zeile, sonst 404. Verhindert dass Caddy für Random-Subdomains Certs anfordert.
- `/admin/settings`: neuer Block „Neue Domain anbinden" mit Schritt-Anleitung (1. CF-DNS A-Record auf VPS, 2. im Tenant-Formular eintragen, 3. fertig — Caddy holt Cert binnen 30s).
- `scripts/setup-server2.sh`: Caddyfile-Template + xcaddy-Build dokumentieren.

**User-Aufwand pro neuer Domain danach:** DNS-A-Record bei Cloudflare + Tenant/Alias eintragen. Kein SSH.

---

## 3. Hard-Bounce-Handling

**Heute:** `email_send_log` und `reminder_log` speichern `status=failed` + `error`. Bei nächstem Recovery-Lauf werden tote Adressen erneut versucht → Reputation leidet.

**Plan:**
- Migration: `profiles.email_status` (`active` | `bounced` | `complained`) + `applications.email_status`. Default `active`.
- Migration: View/Function `mark_email_bounced(email text, reason text)` → setzt `email_status='bounced'` auf passenden Zeilen + schreibt `activity_log`.
- `send-reminders/index.ts`: nach jedem Send-Fehler `error`/`response_code` parsen — wenn `5xx` SMTP-Code → `mark_email_bounced` aufrufen. Vor dem Send: `email_status != 'active'` → überspringen + als `skipped` loggen.
- `/admin/employees` + `/admin/applications.index`: kleines Badge „📭 bounced" + Filter „nur aktive E-Mails", manueller Reset-Button („Adresse wieder zulassen").
- Optional Phase 2: wenn ein Mailgun/SES-Webhook existiert, hier andocken. Aktuell parsen wir nur SMTP-Response.

---

## 4. Reihenfolge

1. Recovery-Cleanup (Bewerber raus, Mitarbeiter-Filter „still" — kleiner Eingriff)
2. Bounce-Handling Migration + send-reminders-Filter (verhindert Schaden bei nächstem Recovery)
3. Caddy/Cloudflare-DNS-01-Setup + `caddy-ask`-Route + Admin-Doku-Block
4. UI-Badges für bounced

---

## Vor dem Bauen brauche ich von dir

1. **Recovery-Definition OK?** „Mitarbeiter ohne anstehenden Reminder in 7 Tagen" — oder lieber **alle Mitarbeiter** (auch wer eh bald Reminder kriegt, kriegt halt 2 Mails)?
2. **Cloudflare API-Token**: bist du OK damit, einen Zone:DNS:Edit-Token zu erstellen und mir als Secret bereitzustellen? (Ohne den geht 1-Klick-Domain nicht — Alternative wäre Cloudflare-Origin-Certs manuell pro Domain.)
3. **Bounce-Reset**: soll nach X Tagen automatisch „bounced" → „active" zurückspringen, oder nur manuell per Button?
