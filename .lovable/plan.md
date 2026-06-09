## Befunde

### 1. „E-Mail Templates" leer
Im Screenshot ist nur „Tenant wählen…" zu sehen, das Dropdown bleibt leer. Du hast aber unter `/admin/tenants` 2 Tenants (Digital DGI GmbH, Kadermarketing Agentur) → Daten existieren, also liegt es nicht an RLS für die ganze Tabelle.

Ursache mit hoher Wahrscheinlichkeit: Der SELECT-Query in `admin.email-templates.tsx` (Zeile 326) fordert u.a. diese Spalten an:
- `reminder_recovery_bewerber_subject/body` (Migration `20260606200000_recovery_template_split.sql`)
- `reminder_appointment_subject/body` (Migration `20260608120000_appointment_reminder.sql`)

Wenn eine dieser Migrationen in deiner DB **noch nicht angewendet** ist, schlägt der ganze SELECT mit „column does not exist" fehl. Der Code ignoriert den Fehler (`const { data } = ...` ohne Error-Handling) → `data = null` → `tenants = []` → Dropdown leer, kein sichtbarer Fehler.

### 2. Bewerber-Einladung — geht die raus?
Zwei Stufen, beide untersucht:

| Stufe | Function | Status |
|---|---|---|
| Initial bei „Bewerbung akzeptieren" | `send-invitation-email` | ✅ Code letzte Runde geschrieben — **muss noch von dir deployed werden** (`supabase functions deploy send-invitation-email --no-verify-jwt`). Solange nicht deployed: Toast „E-Mail fehlgeschlagen". |
| Erinnerung nach 3 Tagen (Bewerber hat sich nicht registriert) | `send-reminders` → `runInvites` | ✅ Funktioniert: filtert `applications.status='akzeptiert'`, `updated_at` älter als 3 Tage, ohne Auth-Account. Nutzt `reminder_invite_subject/body`. |

### 3. Wie wird Mail-Versand pausiert? Übersicht aller Stop-Mechanismen

| Mechanismus | Wo gesetzt | Wirkung |
|---|---|---|
| **Mails pausieren-Button** (`tenants.emails_paused=true`) | Admin > Domains, manuell oder Auto | Alle Reminder/Welcome/Reset für diesen Tenant gestoppt |
| **Auto-Pause: alle Domains down** | Domain-Health-Cron alle 5 Min | Setzt `emails_paused=true` wenn primary + alle Aliases nicht erreichbar |
| **Auto-Pause: SMTP-Verify 3x fehlgeschlagen** | `verifyOrPause` in Send-Functions | Setzt `emails_paused=true` nach 3 konsekutiven SMTP-Fails |
| **Tenant deaktivieren** (`tenants.is_active=false`) | Admin > Domains Button „Deaktivieren" | Domain-Cron pingt nicht mehr; **send-reminders filtert NICHT nach `is_active`** → Mails gehen trotzdem raus! ⚠️ |
| **SMTP nicht vollständig konfiguriert** | `hasValidSmtp(tenant)` Check | Skip mit Reason `no_tenant_smtp` |
| **Bounce-Suppression** (`profiles.email_status != 'active'` oder `applications.email_status='bounced'`) | Automatisch bei Bounce | Einzelner Empfänger übersprungen |
| **Suppression-Liste** (`suppressed_emails`) | Bounce/Complaint-Handler | Einzelner Empfänger übersprungen |
| **Quiet Hours + Min-Days-Between** | `canSend()` in send-reminders | Reminder-Mails gedrosselt (gilt nicht für Welcome/Reset) |
| **Mitarbeiter-Status `deaktiviert`/`abgelehnt`** | RLS-Filter in send-reminders | Person bekommt keine Reminder |
| **pg_cron-Job aus** | DB-seitig | Reminder-Funktionen werden nicht mehr getriggert |

→ **Antwort kurz:** Nein, „Mails pausieren" ist nicht der einzige Schalter. Praktisch relevant für dich sind:
- „Mails pausieren" pro Tenant (Haupt-Kill-Switch)
- Auto-Pause (Domain-Down, SMTP-Fail)
- Empfänger-bezogen: Bounce-Suppression
- ⚠️ **Inkonsistenz: „Tenant deaktivieren" stoppt den Versand nicht** — das sollte es eigentlich

## Umsetzungsplan

### Step 1: Templates-Seite resilient machen
`src/routes/admin.email-templates.tsx` `loadTenants()`:
- Error vom Select abfangen (`const { data, error }`).
- Bei Fehler: Toast mit Original-Fehlermeldung + Hinweis „Migrationen anwenden" anzeigen, `loading=false`, leere Liste bleibt mit klarer Meldung statt stiller weißer Fläche.
- Reihenfolge des Selects so umstellen, dass die kritischen Spalten am Ende stehen — und zusätzlich ein Fallback-Retry **ohne** die neuen Reminder-Spalten (`reminder_appointment_*`, `reminder_recovery_bewerber_*`), damit die Seite auch ohne angewandte Migration nutzbar bleibt; in dem Fall kleines Banner „Einige neue Felder fehlen — Migration anwenden".

### Step 2: „Tenant deaktivieren" konsistent machen
In `send-reminders/index.ts` und neuer `send-invitation-email`: Tenants-Load um `is_active` erweitern und `hasValidSmtp` so erweitern, dass `is_active=false` denselben Skip-Pfad wie `emails_paused` nimmt (Reason `tenant_inactive`).

Gleichermaßen in `send-password-reset`, `send-signup-confirmation`, `resend-signup-confirmation`, `send-appointment-reminders` — überall denselben Guard. Damit wirkt „Tenant deaktivieren" tatsächlich als globaler Off-Schalter.

### Step 3: User-Hinweis (kein Code)
Im Chat zwei Schritte für dich:
1. Migrationen `20260606200000_recovery_template_split.sql` und `20260608120000_appointment_reminder.sql` per `bash scripts/migrate.sh` einspielen.
2. Edge Functions deployen: `send-invitation-email` (neu) + `send-reminders` / `send-password-reset` / `send-signup-confirmation` / `resend-signup-confirmation` / `send-appointment-reminders` (wegen `is_active`-Guard).

### Step 4 (kein Code, nur Doku im Chat)
Kurze Pause-Mechanismen-Übersicht (siehe Tabelle oben), damit du jederzeit weißt, wie du den Versand stoppst.
