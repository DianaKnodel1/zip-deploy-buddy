-- ============================================================================
-- DOMAIN HEALTH CRON
-- Pingt alle 5 Min die Tenant-Domains via /api/public/domain-health-cron.
-- Bei "down" wird ein activity_log-Eintrag geschrieben (Admin sieht ihn auf
-- /admin/activity). Auth via ?key=<CRON_SECRET>.
-- ============================================================================

-- Voraussetzungen
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- TODO BEFORE APPLYING:
--   1) Setze CRON_SECRET als Env-Var im Hosting (Cloudflare Worker) → zufälliger String
--   2) Ersetze <PROJECT_DOMAIN> mit der Produktions-URL deiner App
--      (z.B. project--<project-id>.lovable.app oder dein Custom-Domain)
--   3) Ersetze <CRON_SECRET> mit dem gleichen Wert wie oben
--
-- Beispiel-URL: https://project--xxxxx.lovable.app/api/public/domain-health-cron?key=geheim123

-- Alten Job entfernen (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('domain-health-cron');
EXCEPTION WHEN OTHERS THEN
  NULL;
END$$;

-- Alle 5 Minuten pingen
SELECT cron.schedule(
  'domain-health-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://<PROJECT_DOMAIN>/api/public/domain-health-cron?key=<CRON_SECRET>',
    timeout_milliseconds := 30000
  );
  $$
);
