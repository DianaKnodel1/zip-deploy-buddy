# 30-Minuten-Termin-Reminder

Sendet 30 Min vor einem gebuchten Termin (`bookings.booking_date + booking_time`) automatisch eine Mail an den Mitarbeiter. Nutzt das SMTP des jeweiligen Tenants, respektiert `emails_paused` und läuft alle 10 Min per pg_cron.

## 1. Datenbank-Migration

Neue Datei `supabase/manual-migrations/20260608120000_appointment_reminder.sql`:

- **`tenants`**: 2 neue Spalten
  - `reminder_appointment_subject text`
  - `reminder_appointment_body text`
- **Neue Tabelle `appointment_reminder_log`**
  - `booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE`
  - `tenant_id uuid NOT NULL`
  - `sent_at timestamptz NOT NULL DEFAULT now()`
  - `recipient_email text NOT NULL`
  - GRANT + RLS (nur service_role schreibt, authenticated liest eigenen Tenant)
  - Garantiert Idempotenz: pro Booking maximal 1 Reminder

## 2. Default-Template (im Code, src/lib/reminder-defaults.ts oder direkt in admin.email-templates.tsx)

```
Subject: Erinnerung: Dein Termin in 30 Minuten
Body:
Hallo {{employee_name}},

kurze Erinnerung: dein Termin startet in 30 Minuten ({{appointment_time}} Uhr).

Bitte sei rechtzeitig bereit.

Viele Grüße
{{tenant_name}}
```

Platzhalter: `{{employee_name}}`, `{{appointment_time}}`, `{{appointment_date}}`, `{{tenant_name}}`, `{{portal_url}}`.

## 3. UI-Editor (`src/routes/admin.email-templates.tsx`)

- Type-Erweiterung um `reminder_appointment_subject/body`
- Defaults in `REMINDER_DEFAULTS` (neuer Key `appointment_30min`)
- Neuer Tab/Card „30 Min vor Termin" im Reminder-Bereich, identisches Pattern wie die bestehenden Reminder-Editoren
- Select-Query um die zwei Spalten erweitern
- Save-Payload um die zwei Spalten erweitern

## 4. Neue Edge Function `supabase/functions/send-appointment-reminders/index.ts`

Eigenständig (nicht in `send-reminders` reinpacken — andere Cadence, anderes Anti-Spam-Profil).

Logik pro Lauf:
1. Lade alle `bookings` mit Status ∈ {`booked`, `confirmed`} (oder analoger Default-Status), bei denen `booking_date + booking_time` zwischen `now + 25 Min` und `now + 40 Min` liegt (Toleranzfenster ±5 Min um die 30 Min).
2. Skippe Bookings, deren `id` bereits in `appointment_reminder_log` steht (Idempotenz).
3. Lade je Booking: `profiles.email`, `profiles.full_name`, `tenants` via `profiles.tenant_id`.
4. Skippe Tenant wenn `emails_paused = true` oder `hasValidSmtp(tenant) === false`.
5. Rendere Template, sende via Tenant-SMTP (`nodemailer`, gleiches Pattern wie `send-reminders`).
6. Logge in `appointment_reminder_log` (success) bzw. `email_send_log` (failure).
7. Dry-Run-Modus: `POST { dry_run: true }` zählt nur, sendet nicht.

KEINE Quiet-Hours-Sperre (Termin-Reminder müssen auch früh/spät rausgehen, wenn der Termin dann ist). KEIN Min-Days-Between-Gate.

## 5. Cron

In derselben Migration:

```sql
SELECT cron.schedule(
  'send-appointment-reminders',
  '*/10 * * * *',
  $$ SELECT net.http_post(
       url := 'https://<project>.functions.supabase.co/send-appointment-reminders',
       headers := jsonb_build_object('Authorization', 'Bearer <service-role>')
     ); $$
);
```

## 6. Admin-UI Trigger (optional, klein)

In `/admin/reminders` analog zu bestehenden Buttons: „Termin-Reminder jetzt prüfen (Dry-Run)" + „Jetzt senden".

## Technische Hinweise

- Edge Function NICHT als TanStack-Server-Function — bestehender Reminder-Stack läuft auf Supabase Edge Functions, Konsistenz wichtig.
- Tenant-Isolation: SMTP wird strikt aus `profiles.tenant_id → tenants` gezogen, nie cross-tenant.
- Bei Booking-Cancellation (`status` != aktiv) wird automatisch nicht mehr gesendet (Step 1 filtert).
- Bei nachträglicher Terminverschiebung: `appointment_reminder_log.booking_id` ist UNIQUE → wenn der Reminder bereits raus ist, kommt keine neue Erinnerung. Optional erweiterbar auf `(booking_id, booking_date, booking_time)` als Composite Key — bitte vorher bestätigen, ob das gewünscht ist.

## Reihenfolge der Umsetzung

1. SQL-Migration schreiben (Tabelle + Spalten + Cron)
2. Edge Function erstellen
3. Template-UI erweitern
4. Admin-Trigger-Button (optional)
5. User testet via Dry-Run, dann scharf schalten