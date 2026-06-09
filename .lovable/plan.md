## Befunde aus dem Audit

### 1. Domain down → Versand stoppen
Bereits korrekt eingebaut in `src/routes/api/public/domain-health-cron.ts`:
- Pingt alle 5 Min jede Tenant-Domain (primary + aliases)
- Wenn **alle** Domains down: `tenants.emails_paused = true` (Auto-Pause)
- Kein Auto-Resume (Admin muss manuell freigeben — verhindert Mail-Flut nach Restore)
- Alle Send-Functions (`send-reminders`, `send-password-reset`, `send-signup-confirmation`, `resend-signup-confirmation`, `send-appointment-reminders`) prüfen `emails_paused` und überspringen den Versand

Du willst es so lassen (nur bei ALLE down) — **keine Änderung nötig**.

### 2. Mail-Versand-Audit

| Mail | Trigger | Status |
|---|---|---|
| **Willkommens-Mail (Bewerbung akzeptiert)** | `admin.applications.$appId.tsx` → `supabase.functions.invoke("send-invitation-email")` | ❌ **KAPUTT** — Edge Function `send-invitation-email` existiert nicht in `supabase/functions/` |
| **E-Mail bestätigen (Resend)** | `resend-signup-confirmation` | ✅ vorhanden, prüft `emails_paused` |
| **Bewerber-Einladung (Reminder)** | `send-reminders` Typ `invite` / `reminder_invite` | ✅ vorhanden |
| **Onboarding abschließen Reminder** | `send-reminders` Typ `complete_registration` | ✅ vorhanden (generisch, prüft nicht spezifisch Vertrag/Ausweis — laut deiner Antwort OK so) |
| **Termin-Reminder 30 Min vorher** | `send-appointment-reminders` | ✅ vorhanden |
| **Passwort-Reset** | `send-password-reset` | ✅ vorhanden |

→ **Konkret kaputt: die Willkommens-Mail beim Akzeptieren einer Bewerbung geht NICHT raus.** Der Frontend-Code wirft einen Toast „E-Mail fehlgeschlagen", weil die aufgerufene Edge Function nicht deployed ist.

### 3. E-Mail-Templates lädt nicht
Screenshot fehlt noch — du wolltest ihn nachreichen. **Ohne Screenshot/Konsolen-Fehler kann ich die Ursache nicht eindeutig diagnostizieren.** Wahrscheinliche Kandidaten:
- RLS-Fehler beim `tenants`-Select mit den neuen Reminder-Spalten
- Spalte aus dem `.select(...)` existiert in der DB nicht (Migration vergessen)
- JS-Error nach `setLoading(true)` ohne `setLoading(false)` im Error-Pfad

## Umsetzungsplan

### Step 1: Welcome-Mail reparieren (Pflicht)
Neue Edge Function `supabase/functions/send-invitation-email/index.ts` analog zu `resend-signup-confirmation`:
- Input: `to, fullName, firstName, lastName, registrationLink, tenantId`
- Lädt Tenant + SMTP, prüft `emails_paused` und `hasValidSmtp`
- SMTP-Verify via `verifyOrPause` (Auto-Pause nach 3 Fails)
- Rendert HTML im Tenant-Branding (Logo, Primary Color), enthält:
  - Begrüßung mit `firstName`
  - Hinweis „Bewerbung wurde akzeptiert"
  - CTA-Button → `registrationLink`
  - Fallback-Text-Link
- Versendet via `nodemailer`
- Loggt in `email_send_log` (template: `welcome_invitation`, `rendered_html`, `rendered_subject`, `tenant_id`)
- CORS, generischer 200-OK bei nicht-kritischen Fehlern, klare 4xx/5xx bei Konfig-Problemen

Deploy-Hinweis im Chat: User muss `supabase functions deploy send-invitation-email --no-verify-jwt` ausführen (analog zu den bestehenden).

### Step 2: Templates-Lade-Bug
**Warte auf Screenshot.** Sobald da, prüfe ich:
1. Browser-Konsole (Fehler-Stack)
2. Network-Tab (welcher Request fehlschlägt, Status-Code, Response-Body)
3. `admin.email-templates.tsx` `useEffect` / `loadData` — speziell die Select-Query gegen `tenants`
4. Bei DB-Fehler: prüfe ob alle referenzierten Spalten existieren (z.B. `reminder_appointment_subject/body` aus der 20260608120000-Migration)

### Step 3 (optional, nicht Teil dieses Plans): Onboarding-Reminder
Du willst Status quo → keine Änderung.

## Reihenfolge
1. `send-invitation-email` Edge Function bauen
2. Du schickst Screenshot → ich diagnostiziere Templates-Problem und fixe separat
3. Du deployst die neue Function + testest „Bewerbung akzeptieren" → Welcome-Mail kommt an
