## Ziel
Admin-Sichtbarkeit über Reminder-/E-Mail-System schaffen: was wurde wann an wen geschickt, wie läuft der Cron, gibt es Probleme?

## 1. Audit-Log Viewer (neuer Tab unter `/admin/recovery`)

**UI:** Neuer Tab „Verlauf" neben „Vorschau" und „Bounces".

**Inhalt:** Tabelle aus `reminder_log` mit:
- Spalten: Zeitpunkt, Empfänger, Typ (Badge: invite / confirm / completion / no_booking / recovery), Status (sent / failed / skipped), Fehler-Snippet
- Filter oben:
  - Empfänger-Suche (E-Mail enthält…)
  - Typ-Dropdown (alle / einzeln)
  - Status-Dropdown (alle / sent / failed / skipped)
  - Zeitraum (Heute / 7 Tage / 30 Tage / Custom)
- Paginierung (50 pro Seite, neueste zuerst)
- CSV-Export-Button für gefilterte Ansicht

**Server:** Neue Server-Function `listReminderLog({ filters, page })` in `src/lib/reminder-log.functions.ts`, gated mit `requireSupabaseAuth` + Admin-Check.

## 2. Cron-Health-Karte (oben auf `/admin/recovery`)

**UI:** Kompakte Status-Karte ganz oben mit:
- Letzter Run: „vor 3 Min" (grün) / „vor 42 Min ⚠️" (gelb) / „vor >2h 🔴" (rot)
- Stats der letzten 24h: gesendet / fehlgeschlagen / übersprungen
- Anzahl `bounced`-Empfänger (Link zum Bounces-Tab)
- Manueller „Jetzt ausführen"-Button (triggert `send-reminders` mit `dryRun=false`)

**Server:** Neue Server-Function `getReminderHealth()`:
- Liest letzten `created_at` aus `reminder_log`
- Aggregiert Counts der letzten 24h
- Zählt `email_status='bounced'` über `profiles` + `applications`

**Schwellen:**
- grün: < 15 Min
- gelb: 15–60 Min
- rot: > 60 Min

## 3. Edge-Function-Erweiterung (minimal)

`send-reminders` schreibt bereits in `reminder_log`. Sicherstellen, dass auch `skipped`-Events (z.B. `tenant_run_cap_reached`, `bounced`, `next_attempt_in_future`) als Zeile mit `status='skipped'` + Reason geloggt werden, damit der Audit-Log diese Fälle sichtbar macht. Aktuell werden manche nur in `results` zurückgegeben, nicht persistiert.

## Technische Details

**Files:**
- NEU: `src/lib/reminder-log.functions.ts` (listReminderLog, getReminderHealth)
- EDIT: `src/routes/admin.recovery.tsx` (Health-Karte + Tab „Verlauf")
- EDIT: `supabase/functions/send-reminders/index.ts` (skipped-Logging vereinheitlichen)

**Keine Migration nötig** — `reminder_log` existiert bereits.

**Manuelle Aktion nach Build:** `supabase functions deploy send-reminders`

## Was NICHT Teil dieses Plans ist
- #1 Reminder-Cap pro Empfänger
- #3 Test-Mail-Button im Template-Editor
- #5/#6 Soft-Bounce / Unsubscribe-Footer
- #10/#11 Domain-Health / Caddy
→ Können in Folge-Iterationen kommen.