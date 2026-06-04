## Anosim SMS-Polling einbauen

### Was gebaut wird

1. **DB-Migration** (`supabase/manual-migrations/20260604210000_sms_provider_dedup.sql`)
   - `sms_messages.provider_message_id text` (für Deduplizierung)
   - Unique-Index `(channel_id, provider_message_id)` – damit dieselbe SMS beim wiederholten Polling nicht doppelt landet
   - Optional: ein zentraler `ANOSIM_API_KEY` ist **nicht nötig** – wir nutzen pro Channel den vorhandenen `sms_channels.api_key`

2. **Server-Funktion `pollAnosimSms`** (`src/lib/sms-poll.functions.ts`)
   - Holt alle Channels mit `provider='anosim'` + gesetztem `api_key`
   - Gruppiert nach `api_key` (damit pro Account nur 1 Request rausgeht)
   - Ruft `GET https://anosim.net/api/v1/Sms?apikey=...`
   - Für jede SMS: matche `simCardNumber` → `sms_channels.phone_number`, hol das aktive `sms_assignment` (user_id) und insert in `sms_messages` mit `direction='inbound'`, `provider_message_id = hash(simCardNumber + messageDate + messageSender + messageText)`
   - Konflikte (= bereits vorhandene SMS) werden via `ON CONFLICT DO NOTHING` ignoriert
   - Gibt `{ pulled, inserted, errors }` zurück

3. **Server-Route `/api/public/sms-poll-cron`** (`src/routes/api/public/sms-poll-cron.ts`)
   - Ruft `pollAnosimSms()` auf
   - Header-Auth via `X-Cron-Secret` (neuer Secret `CRON_SECRET`, falls noch nicht vorhanden – sonst bereits genutzten Secret wiederverwenden)
   - Wird vom Linux-Cron auf VPS 2 alle 30 s aufgerufen (curl)

4. **Mitarbeiter-/Admin-Seite: „Aktualisieren"-Knopf triggert sofortiges Polling**
   - `src/routes/_employee/sms.tsx`: vor `loadData()` `pullNow()` aufrufen
   - `src/routes/admin.sms.tsx`: gleicher Knopf
   - Damit muss der Mitarbeiter nicht 30 s warten

5. **Setup-Doku** in der finalen Chat-Antwort:
   - Migration laufen lassen (`bash scripts/migrate.sh`)
   - Cron-Eintrag auf VPS 2: `* * * * * curl -fsS -H "X-Cron-Secret: …" https://portal.../api/public/sms-poll-cron >/dev/null` (+ alle 30 s mit `sleep 30`-Trick)
   - `CRON_SECRET` in `/etc/portal.env` ergänzen + `systemctl restart portal`

### Was NICHT in diesem Schritt enthalten ist

- Outbound-SMS (SMS senden) – das wäre `POST /Orders` und ist eine separate Story
- Automatisches Bestellen neuer Nummern – Admin bestellt manuell bei Anosim und trägt Nummer + API-Key ein

### Wie's danach läuft

```
Test-SMS an Nummer → Anosim Inbox
        ↓ (alle 30 s)
Cron → /api/public/sms-poll-cron
        ↓
pollAnosimSms() → GET /api/v1/Sms?apikey=…
        ↓
Match simCardNumber → sms_channels → assignment.user_id
        ↓
INSERT INTO sms_messages (… direction='inbound')
        ↓
Mitarbeiter sieht's auf /sms (oder nach „Aktualisieren")
```

OK, soll ich so bauen?
