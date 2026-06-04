
# Deploy auf Self-Hosting (api.mb-portal.com)

Wir gehen die Deploy-Schritte **gemeinsam Stück für Stück** durch — nach jedem Schritt sagst du "ok" und ich gehe zum nächsten weiter. So fangen wir uns Fehler früh ein.

---

## Phase 1 — Datenbank-Migrationen anwenden (Server 3 / Supabase)

Drei manuelle SQL-Migrationen liegen unter `supabase/manual-migrations/` und müssen auf `api.mb-portal.com` ausgeführt werden:

1. **`20260603000000_domain_health_cron.sql`** — pg_cron Job für Domain-Health
   - Vorher in der Datei `<PROJECT_DOMAIN>` durch `api.mb-portal.com` (bzw. Portal-Domain) ersetzen
   - `CRON_SECRET` Platzhalter mit echtem Secret befüllen
2. **`20260604100000_reminder_log_domain_recovery.sql`** — erweitert `reminder_log` um `domain_recovery`
3. **`20260604200000_admin_delete_actor.sql`** — Fix für „Mitarbeiter löschen / Nicht autorisiert"

**Ausführung:**
```bash
psql "$TARGET_DB_URL" -f supabase/manual-migrations/20260603000000_domain_health_cron.sql
psql "$TARGET_DB_URL" -f supabase/manual-migrations/20260604100000_reminder_log_domain_recovery.sql
psql "$TARGET_DB_URL" -f supabase/manual-migrations/20260604200000_admin_delete_actor.sql
```

**Verifikation:** Counts checken + `\df admin_delete_user_cascade` muss 2-Parameter-Variante zeigen.

---

## Phase 2 — Edge Function `send-reminders` redeployen

Tenant-Isolation- und Janina-Fix sind in `supabase/functions/send-reminders/index.ts`. Auf self-hosted Supabase:

```bash
supabase functions deploy send-reminders --project-ref <self-hosted-ref>
```
oder via self-hosted CLI/Studio.

**Secrets prüfen** (müssen im self-hosted Supabase gesetzt sein):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY` (oder welcher Mail-Provider)
- `CRON_SECRET` (gleicher Wert wie Migration aus Phase 1)

---

## Phase 3 — Frontend-Env auf Server 2 prüfen

`.env` auf dem Portal-Server (`/opt/apps/portal/.env`) muss zeigen auf:
```
VITE_SUPABASE_URL=https://api.mb-portal.com
SUPABASE_URL=https://api.mb-portal.com
VITE_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # nur server-seitig!
```
Die `.env` im Repo zeigt schon korrekt auf `api.mb-portal.com` ✓.

---

## Phase 4 — Frontend bauen + deployen (Server 2)

Per SSH auf den Portal-Server:
```bash
cd /opt/apps/portal
git fetch origin
git pull --ff-only origin main
bun install --frozen-lockfile
bun run build
sudo systemctl restart portal.service
sudo systemctl status portal.service --no-pager | head -20
journalctl -u portal -f   # Live-Logs zum Mitlesen
```

Alternativ: `bash scripts/migrate.sh` macht Phase 4 automatisch (nur Frontend-Block, kein neuer DB-Dump).

---

## Phase 5 — Smoke-Tests (read-only, vor echtem Cron-Run)

1. `https://mb-portal.de` öffnet sich, Login geht
2. Admin → `/admin/recovery` lädt (Tabelle + Reminder-Status)
3. Admin → `/admin/reminders` lädt
4. Admin → `/admin/kyc` → Doppelklick auf Bild öffnet Lightbox
5. Admin → Mitarbeiter löschen (Test-Account!) — Cascade funktioniert
6. Manueller Cron-Test:
   ```bash
   curl -X POST "https://mb-portal.de/api/public/domain-health-cron" \
        -H "x-cron-secret: $CRON_SECRET"
   ```

---

## Phase 6 — Rollback-Plan (falls etwas schiefläuft)

- DB-Backup hat `scripts/migrate.sh` automatisch gemacht (`$WORKDIR/target-backup-before-restore.pgcustom`)
- Frontend-Rollback: `git checkout <prev-sha> && bun run build && systemctl restart portal`
- Edge-Function: vorherige Version via Supabase Studio re-deployen

---

## Reihenfolge & Bestätigung

Wir machen **Phase 1 zuerst**. Du sagst mir:
- (a) Hast du `psql`-Zugriff auf `api.mb-portal.com` von deinem lokalen Rechner aus? Wenn ja, mit welchem User?
- (b) Ist der `CRON_SECRET` schon gewählt oder soll ich einen vorschlagen?
- (c) Welche Domain soll im Cron-Job stehen — `mb-portal.de`, `mb-portal.com`, oder beide nacheinander?

Sobald die drei Fragen geklärt sind, gebe ich dir die exakten Befehle für Phase 1 und wir warten auf dein „ok" bevor wir zu Phase 2 gehen.
