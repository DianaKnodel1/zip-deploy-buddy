## Antworten kurz + Fixes pro Punkt

### 1. HTML-Vorschau & Absender fehlen (auch bei heutiger Mail)
Ursache: Die Edge-Function `send-reminders` schreibt aktuell **nichts** in `email_send_log` — sie hat eine eigene Tabelle `reminder_log` (ohne HTML/Absender). Deshalb zeigt der Logs-Modal "kein gerendertes HTML gespeichert". Der Hinweis "Neu versendete Mails ab dem Update…" war Wunsch, ist aber bei Reminder-Mails noch nicht aktiv.

**Fix:** `send-reminders` zusätzlich in `email_send_log` schreiben — mit `rendered_subject`, `rendered_html`, `sender_email`, `tenant_id`, `metadata.smtp_host`, `message_id`. Sowohl bei Erfolg als auch Fehler (bei Fehler ohne `rendered_html` falls vor dem Render abgebrochen, sonst mit). Danach: Vorschau funktioniert für alle künftigen Reminder.

Für die heutige 7.6. 03:54-Mail: kann **rückwirkend nicht** wiederhergestellt werden — Vorschau erst ab nächstem Run.

### 2. Banner "Aktion erforderlich – 40 E-Mails"
Aktuell zählt der Banner **alle** failed-Logs (auch alte permanente Fehler wie SMTP-Auth-Failure). Das ist Lärm.

**Fix:**
- Banner zählt nur Fails der **letzten 24h**, die **nicht "bounced/auth-failed permanent"** sind.
- Button "Alle als bearbeitet markieren" → setzt eine neue Spalte `acknowledged_at` in `email_send_log`. Acknowledgte Fails fallen aus dem Banner raus, bleiben aber in der Tabelle sichtbar (mit Badge "bearbeitet").
- Banner-Text: konkrete Empfehlung ("SMTP-Login prüfen", "Bounce-Liste leeren") basierend auf häufigster Fehlerursache der letzten 24h.

### 3. "Reminder-Cron" Karte auf /admin/recovery zeigt "Unbekannt"
"Unbekannt" = noch nie ein Cron-Run im `reminder_log` registriert. Die Karte zeigt Cron-Health (wann lief der automatische 5-Min-Job zuletzt) — ist eine andere Sicht als die Reminder-Tabelle (welche Mails). Aber auf der Recovery-Seite verwirrt sie.

**Fix:** Karte von `/admin/recovery` **entfernen** (gehört thematisch zu Reminders) und stattdessen auf `/admin/reminders` oben einblenden. Auf Recovery bleibt nur der Recovery-eigene Cron-Status.

### 4. Reminder-Limit pro Tenant
Aktuell: `MAX_SENDS_PER_RUN_PER_TENANT = 50` pro Typ pro Run. Bei 4 Typen × 5-Min-Cron × 12h = theoretisch 12 000 / Tenant — aber praktisch limitiert durch Empfängerpool. Gewünscht: **240 Mails / 12h pro Tenant** als harte Obergrenze.

**Fix:** Neuer Check in `send-reminders`: vor Versand pro Tenant zählen, wieviele Mails dieser Tenant in den letzten 12h verschickt hat (aus `reminder_log` `status='sent'`). Wenn ≥ 240 → alle weiteren Mails dieses Tenants in diesem Run skippen mit Grund `tenant_12h_cap_reached`. Konfigurierbar als Konstante `MAX_SENDS_PER_TENANT_PER_12H = 240`.

### 5. Mail beim Akzeptieren der Bewerbung
✅ Bereits aktiv — `sendWelcomeEmail()` wird in `admin.applications.$appId.tsx` direkt aufgerufen wenn Status auf `akzeptiert` geht. Fallback über `reminder_invite` Cron falls Sofort-Mail fehlschlägt. Keine Änderung nötig.

### 6. Passwort-vergessen / Registrieren scheitert bei `serkanmelihoff23@outlook.de`
Wichtig: Das sind **Supabase-Auth-Mails** (recovery, signup-confirmation) — die laufen **nicht** über Tenant-SMTP, sondern über den Default-Supabase-Mailer oder den in Supabase-Project konfigurierten Custom SMTP. Fehler "Error sending recovery email" = Supabase konnte die Mail nicht rausgeben.

Mögliche Ursachen (von wahrscheinlich nach unwahrscheinlich):
1. **Diese Adresse ist auf Supabase-Rate-Limit/Bounce-Sperre** (du hast sie zigfach getestet → Supabase blockt sie temporär für ~1h).
2. **Default-Supabase-SMTP** hat 4 Mails/h Limit — bei vielen Tests sofort erschöpft.
3. Kein Custom SMTP in Supabase Auth → Settings hinterlegt.

**Fix-Schritte (ohne Code):**
- In Supabase Dashboard → Authentication → Email Templates → **Custom SMTP aktivieren** mit den gleichen Privateemail-Daten wie im Tenant (oder einem dedizierten Auth-SMTP).
- Solange das nicht passiert: Test mit **anderer Adresse** (z.B. neue Gmail). Wenn die geht → Rate-Limit auf deiner Outlook-Adresse.

**Code-Seite** ist sauber — `forgot-password.tsx` ruft korrekt `supabase.auth.resetPasswordForEmail()` auf.

## Implementierungs-Reihenfolge
1. **#1 + #4 zusammen**: Edge-Function `send-reminders` patchen (Logs in `email_send_log` schreiben + 12h-Cap pro Tenant). Manueller Redeploy.
2. **#2**: Migration `email_send_log.acknowledged_at`, Banner-Logik + Button im UI.
3. **#3**: Cron-Karte von `/admin/recovery` entfernen, in `/admin/reminders` einbauen.
4. **#5**: nichts zu tun, nur dem User bestätigt.
5. **#6**: Nur Doku-Antwort an User (Supabase Dashboard-Aktion nötig — kein Code).

## Geänderte/neue Dateien
- `supabase/functions/send-reminders/index.ts` (Logs schreiben + 12h-Cap)
- `supabase/manual-migrations/20260607010000_email_log_acknowledged.sql` (neu)
- `src/routes/admin.email-logs.tsx` (Banner-Filter, Ack-Button, Badge)
- `src/routes/admin.recovery.tsx` (Cron-Karte entfernen)
- `src/routes/admin.reminders.tsx` (Cron-Karte oben einblenden)

## Bewusst NICHT in diesem Schritt
- Supabase-Auth-SMTP-Konfiguration (Dashboard-Aktion durch dich).
- Rückwirkende HTML-Wiederherstellung alter Logs (technisch unmöglich).
- Soft-Bounce-Klassifizierung (separates Thema, später).
