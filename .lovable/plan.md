## Ziel

Beweisen (nicht nur vermuten), dass die 3 Trigger-Mails wirklich rausgehen:

1. **Registrierung abschließen** → `send-reminders` / `complete_registration`
2. **E-Mail bestätigen** → `send-reminders` / `confirm_email` + `resend-signup-confirmation` (on-demand)
3. **Bewerber-Einladung** → `send-reminders` / `invite` + `send-invitation-email` (on-demand bei Annahme)

## Vorgehen (3 Schritte, ich mache alles)

### Schritt 1 — Cron-Check (wichtigster Punkt)

Erste Sichtung zeigt: in `supabase/manual-migrations/` gibt es nur den **domain-health-cron**. Einen **Cron für `send-reminders` finde ich nirgends** — nur ein Beispiel im README. Wenn das stimmt, gehen Reminder NIE automatisch raus, sondern nur, wenn jemand im Admin auf „Reminder jetzt senden" klickt.

→ Ich frage `pg_cron.job` per Supabase ab und liste alle aktiven Jobs. Falls `send-reminders` fehlt: ich erstelle eine Migration `*_send_reminders_cron.sql` (z. B. stündlich) — analog zum Domain-Health-Job, mit `<CRON_SECRET>`-Placeholder zum Ausfüllen.

### Schritt 2 — Live-Log-Check (letzte 7 Tage)

Per Supabase-DB-Tool dedupliziert pro `message_id`:

```
template_name        | sent | failed | dlq | suppressed
---------------------+------+--------+-----+-----------
invite               |   ?  |   ?    |  ?  |    ?
confirm_email        |   ?  |   ?    |  ?  |    ?
complete_registration|   ?  |   ?    |  ?  |    ?
welcome (invitation) |   ?  |   ?    |  ?  |    ?
```

Plus die letzten 10 `failed`/`dlq`-Einträge mit `error_message`, damit konkrete SMTP-/Token-Fehler sichtbar werden.

### Schritt 3 — Trigger-Audit im Code

Pro Flow kurz bestätigen, dass die Bedingungen sauber sind (Filter, Tenant-SMTP, `is_active`/`emails_paused`, Throttling-Cap). Ich kenne die Funktionen schon aus den letzten Runden — hier nur noch ein Querblick auf die Aufrufstellen:

- `admin.applications.$appId.tsx` → `send-invitation-email` (bei Annahme)
- `admin.applications.index.tsx` + `admin.reminders.tsx` → `send-reminders` (manuell)
- `tenant-domains.functions.ts` → `send-reminders` mit `mode=domain_recovery`

## Was du am Ende bekommst

- Eine klare Tabelle: pro Trigger „✅ läuft / ⚠️ läuft nur manuell / ❌ blockiert weil …"
- Falls Cron fehlt: bereitgestellte Migration zum Aktivieren (du musst nur `<CRON_SECRET>` setzen und ausführen)
- Falls Fehler im Log: konkrete Ursache + Fix-Vorschlag

## Was ich NICHT mache (außer du sagst es)

- Templates ändern
- Bestehende Functions umschreiben
- Cron automatisch ausrollen (gibt Migration, du entscheidest)
