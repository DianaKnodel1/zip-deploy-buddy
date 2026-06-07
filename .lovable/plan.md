# Plan – Stand 7. Juni 2026

## Soeben gebaut

### 1. Recovery-Cleanup (Bewerber raus)
- `getAffectedRecipients` / `getRecoveryPreview` (in `tenant-domains.functions.ts`) liefern nur noch Mitarbeiter mit Auth-Account.
- `send-reminders/index.ts` Domain-Recovery-Loop: keine Bewerber mehr, kein Bewerber-Template-Pfad. `reminder_recovery_bewerber_subject/body` werden nicht mehr gelesen.
- `/admin/email-templates` → Tab „Domain-Wechsel": nur noch ein Editor (Mitarbeiter). Sub-Tabs entfernt.
- `/admin/recovery`: Preview hat keine Tabs mehr, Empfänger-Liste zeigt keinen Bewerber-Badge mehr, Beschreibungstext aktualisiert.
- Bewerber bekommen den neuen Portal-Link automatisch über die normale `reminder_invite`-Mail (die nutzt `tenants.primary_domain` dynamisch).

### 2. Hard-Bounce-Handling
- Migration `20260607000000_email_status_bounce.sql`: `profiles.email_status` + `applications.email_status` (`active` / `bounced` / `complained`) plus `email_bounced_at`, `email_bounce_reason`.
- `send-reminders` markiert Adressen automatisch als `bounced`, wenn die SMTP-Antwort 5.x.x ist (`maybeMarkBounced`).
- `canSend` checkt zuerst `isEmailBounced` → tote Adressen werden in allen Reminder-Typen (`invite`, `confirm_email`, `complete_registration`, `no_recent_booking`) übersprungen und als `skipped:email_bounced` geloggt.
- Recovery-Loop überspringt `email_status != 'active'` schon beim Sammeln der Empfänger.
- `/admin/recovery` → neuer Tab „Bounces": Liste mit Grund + manuellem Reset-Button („Wieder zulassen").
- Neue Server-Funktionen: `listBouncedRecipients`, `resetEmailStatus`.

---

## Manuell auf dem VPS auszuführen

```bash
bash scripts/migrate.sh                                   # Migration 20260607000000 einspielen
supabase functions deploy send-reminders                  # Bounce-Handling + Recovery-Cleanup deployen
```

---

## Verschoben (nicht jetzt)

### 1-Klick-Domain-Onboarding (Caddy + Cloudflare DNS-01)
Bewusst auf später verschoben. Wenn wir das angehen:
- Cloudflare API-Token mit `Zone:DNS:Edit`-Scope → als Secret `CLOUDFLARE_API_TOKEN`.
- Caddy auf Wildcard + on-demand-TLS + `caddy-ask`-Endpoint.
- Neue Server-Route `src/routes/api/public/caddy-ask.ts` validiert eingehende Domains gegen `tenants.domain` + `domain_aliases`.

Heute musst du also für eine neue Domain weiterhin:
1. Cloudflare-DNS A-Record auf VPS-IP setzen,
2. Caddy/Nginx-Config auf VPS ergänzen,
3. Tenant/Alias im Admin-Portal eintragen.
