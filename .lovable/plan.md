
## Befunde aus dem Code

1. **Passwort vergessen schlägt fehl für registrierte Nutzer** (Screenshot 1)
   - `src/routes/forgot-password.tsx` ruft `supabase.auth.resetPasswordForEmail()` → das ist Supabase-Auth-SMTP (NICHT Tenant-SMTP). Für unbekannte E-Mails antwortet Supabase mit „ok" ohne zu senden, deshalb funktioniert es nur dort scheinbar. Für registrierte Adressen läuft Supabase ins Rate-Limit / SMTP-Fehler („Error sending recovery email").
   - Fix: eigene Server-Funktion, die per `supabaseAdmin.auth.admin.generateLink({ type: "recovery" })` einen Reset-Link erzeugt und ihn mit dem **Tenant-SMTP** des passenden Tenants verschickt (genau wie Reminder/Recovery jetzt schon). Reset-Subject/-Body kommen aus `tenants.reset_email_subject/body` (Spalten existieren bereits).

2. **Sabine Frauki ohne Tenant sichtbar** (Screenshot 2+3)
   - In Listen und Detail (`admin.applications.index.tsx`, `admin.employees.$userId.tsx`) gibt es keine Tenant-Anzeige im Header. Tenant muss überall sichtbar sein, damit man sofort sieht, zu welchem Mandant ein Datensatz gehört.

3. **Individueller Vertrag wird ignoriert / alter Vertrag bleibt sichtbar** (Screenshots 4+5)
   - `src/routes/_employee/contract.tsx` Z. 318: wenn ein `contracts`-Eintrag existiert, wird direkt der alte signierte Vertrag gezeigt. Der Override-Branch (Z. 412) wird nur erreicht, wenn KEIN `contract` existiert.
   - Beim Speichern eines neuen Overrides setzen wir `contract_signed_at = null` im Profil, aber der alte `contracts`-Datensatz bleibt liegen → daher das alte PDF.
   - Fix: Im Employee-View Override-`updated_at` mit `contract.signed_at` vergleichen. Ist Override neuer → alten Vertrag ausblenden, OverrideSigning anzeigen. Beim erfolgreichen Re-Signing wird ein neuer `contracts`-Eintrag erzeugt (passiert bereits in `handleSignContract`), der dann der aktuelle ist.

4. **Domain-Wechsel (.de → .com) und Accept-Mail**
   - Reminder/Recovery-Cron nutzt bereits `primary_domain ?? domain` ✓
   - SMTP wird pro Tenant aus `tenants.smtp_*` geladen — Wechsel der Sender-Domain passiert KEIN Cross-Tenant-Routing ✓
   - **Aber**: `admin.applications.index.tsx` baut den Accept-Link aus `tenant.domain` (Z. 78–80), nicht aus `primary_domain`. Nach Umschalten auf `.com` würde der Bewerber weiter `.de` bekommen.
   - Fix: TenantMap auch `primary_domain` laden und Link mit `primary_domain ?? domain` bauen.

## Änderungen

### A) Passwort vergessen via Tenant-SMTP
Neue Server-Funktion `requestTenantPasswordReset` (`src/lib/password-reset.functions.ts`, publik, kein Auth-Middleware):
- Input: `{ email, host }` (host = `window.location.hostname` vom Client).
- Tenant via Host (primary + aliases) auflösen, sonst erster aktiver Tenant.
- `supabaseAdmin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: https://portal.<primary>/reset-password } })`.
- Wenn `tenant.smtp_*` vorhanden: Mail via gleichem nodemailer-ähnlichen Pfad wie `send-reminders` (kleiner Helper extrahieren, oder direkt `nodemailer` im Server-Function). Subject/Body aus `tenants.reset_email_subject/body` (Fallback Default). Platzhalter: `{{reset_url}}`, `{{first_name}}`.
- In `email_send_log` schreiben (template_name=`password_reset`).
- Antwort: immer `{ ok: true }` (keine User-Enumeration).
- `forgot-password.tsx` ruft diese Funktion statt `supabase.auth.resetPasswordForEmail`.

### B) Tenant überall sichtbar
- `admin.employees.$userId.tsx`: Tenant-Name als Badge neben Name (analog Status).
- `admin.applications.index.tsx`: Tenant-Spalte bzw. -Badge in der Zeile.

### C) Override aktualisiert alten Vertrag
`src/routes/_employee/contract.tsx`:
- Beim Laden zusätzlich `override.updated_at` mitnehmen (bereits in `getMyContractOverride`).
- Render-Logik:
  ```
  const overrideNewer = override && override.updated_at && contract
    && new Date(override.updated_at) > new Date(contract.signed_at);
  if (override && (override.html_body || override.pdf_url) && (!contract || overrideNewer)) {
    return <OverrideSigning .../>
  }
  ```
- Beim Speichern eines Overrides (Admin): `contracts.signed_at = null`? — nein, der alte Vertrag bleibt als Historie. Nur Sichtbarkeit umschalten.

### D) Accept-Mail-Link auf primary_domain
- In `admin.applications.index.tsx` Tenant-Map um `primary_domain` erweitern und Link entsprechend bauen.

## Was sich NICHT ändert
- Reminder-Cron, Recovery-Cron, SMTP-Routing pro Tenant — bereits korrekt.
- Auth-Mails von Supabase (Confirm-Mail) bleiben Supabase-SMTP (nur Passwort-Reset wird auf Tenant-SMTP umgestellt, weil das der primäre Schmerz ist).

## Migration
Keine neue Migration nötig — alle Spalten existieren bereits.

## Manuelle Schritte nach Deploy
Keine. Nur Vorhandensein der `reset_email_subject/body` auf Tenants prüfen; sonst greift Default-Template.
