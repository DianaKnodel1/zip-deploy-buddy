## Ziel

1. **Neue Landing-Page / Domain anbinden = nur noch DNS + ein Eintrag im Admin-Portal.** Kein SSH, kein Caddy-Config-Edit mehr.
2. **Recovery-Versand bug-fix** (`updated_at`-Crash → 0 Empfänger).
3. **Recovery-Mail-Editor** in `/admin/email-templates` (zwei separate Templates: Mitarbeiter / Bewerber, Ton "Wir sind umgezogen", ohne Platzhalter-Hinweise).

---

## 1. Domain-Onboarding 1-Klick (das Hauptproblem)

**Heute musst du:**
- DNS `portal.NEUE-DOMAIN.com` → VPS-IP setzen
- Auf VPS: Caddyfile/nginx editieren (`server_name portal.neue-domain.com`)
- Service reloaden
- Tenant in DB anlegen / Domain-Alias eintragen

**Nach diesem Plan musst du nur noch:**
- DNS setzen (einmalig pro Domain, das geht nicht weg)
- Im Admin-Portal: `/admin/tenants` → Domain eintragen → fertig

**Wie:** Caddy/Nginx auf **Wildcard + Catch-All** umstellen statt pro Domain. Der TanStack-Server liest schon `req.headers.host`, der Tenant-Lookup in `TenantContext` matcht per `domain` + `domain_aliases`. Wir brauchen also nur **eine** Caddy-Regel:

```text
portal.*, *.lovable.app {
  reverse_proxy 127.0.0.1:3000
}
```

Caddy macht TLS automatisch via ACME (Let's Encrypt on-demand). Voraussetzung: `on_demand_tls` mit Ask-Endpoint, der gegen unsere Tenant-DB prüft, ob die Domain bekannt ist (sonst stellt Caddy für jede Random-Subdomain Zertifikate aus).

**Konkrete Schritte:**
- Neue Server-Route `/api/public/caddy-ask?domain=...` → `200` wenn Domain in `tenants.domain` oder `domain_aliases` (sonst `404`).
- Caddyfile-Snippet im `/admin/settings` als Copy-Paste anzeigen + Doku-Block "So bindest du eine neue Domain an" (DNS-Record, dann Tenant anlegen).
- `scripts/setup-server2.sh` updaten: einmaliger Caddy-Setup mit Wildcard + on-demand-TLS.

**Ergebnis:** Neue Domain anbinden dauert ~2 Minuten (DNS + 1 Formular), kein SSH mehr.

---

## 2. Recovery-Versand Bug-Fix

**Bug:** `src/lib/tenant-domains.functions.ts` Zeile 178 selektiert `applications.updated_at` — Spalte existiert nicht. Folge: `getAffectedRecipients` crashed silent → 0 Empfänger.

**Fix:** `updated_at` aus dem SELECT entfernen, `last_contact` auf `app.created_at` fallback (Zeile 222).

2-Zeilen-Änderung, dann läuft Recovery wieder.

---

## 3. Recovery-Mail-Editor in `/admin/email-templates`

**Heute:** Felder `tenants.reminder_recovery_subject/body` existieren, aber **kein UI** — nur SQL. Vorschau läuft auf `/admin/recovery`, aber nicht editierbar.

**Plan:**
- In `/admin/email-templates` zwei neue Einträge anlegen:
  - **„Domain-Wechsel – Mitarbeiter"** (CTA: „Zum neuen Portal & Onboarding fortsetzen")
  - **„Domain-Wechsel – akzeptierte Bewerber"** (CTA: „Jetzt registrieren auf der neuen Domain")
- Migration: zwei zusätzliche Spalten
  ```sql
  ALTER TABLE tenants
    ADD COLUMN reminder_recovery_bewerber_subject text,
    ADD COLUMN reminder_recovery_bewerber_body    text;
  -- die bestehenden reminder_recovery_subject/body werden zu "Mitarbeiter"
  ```
- Editor-UI: gleicher Komponenten-Stil wie bestehende Email-Templates-Seite (Subject-Input, HTML-Body, Live-Vorschau rechts daneben).
- **Ton "Wir sind umgezogen":** ich schreibe euch 2 Default-Texte mit freundlichem Umzugs-Wording statt Notfall (Beispiel-Tonalität: „Wir haben eine neue Adresse für dich! Ab sofort findest du dein Portal unter …").
- **Keine Platzhalter-Hinweise mehr** in der UI (du sagtest du brauchst sie nicht) — Platzhalter werden trotzdem ersetzt (`{{first_name}}`, `{{portal_link}}`, `{{tenant_name}}`), nur kein „Verfügbare Platzhalter:"-Hilfetext.
- `send-reminders`-Edge-Function: wählt Template anhand `recipient.kind` (`mitarbeiter` vs `bewerber_akzeptiert`).
- Vorschau auf `/admin/recovery` zeigt beide Templates als Tabs.

---

## 4. Reihenfolge der Umsetzung

1. **Bug-Fix Recovery** (2 Zeilen, sofort, damit Recovery überhaupt sendet)
2. **Migration + Template-Editor** (Mitarbeiter + Bewerber getrennt)
3. **Send-Reminders Edge-Function** an neue Spalten anpassen
4. **Caddy on-demand-TLS + Ask-Endpoint** (das wirft den größten Zeit-Gewinn ab)
5. **Doku-Block** in `/admin/settings` mit Caddyfile-Snippet & Onboarding-Anleitung

---

## Offene Frage vor dem Bauen

Caddy on-demand-TLS heißt: jede Domain, die du in `/admin/tenants` einträgst und deren DNS auf den VPS zeigt, bekommt automatisch ein TLS-Cert. **Cloudflare-User:** wenn du Cloudflare-Proxy (orange Wolke) nutzt, klappt das nicht direkt — dann müsstest du Cloudflare-Origin-Certs nutzen ODER Proxy auf grau stellen.
→ Sag mir bevor ich baue: **läuft `digital-dgigmbh.com` über Cloudflare-Proxy oder direkt auf den VPS?** (Das entscheidet die Caddy-Config.)
