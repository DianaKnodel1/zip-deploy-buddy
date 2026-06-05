# Großes Update – Plan

## 1. Test-Versand für Reminder + Recovery

**Was:** Analog zum Einladungs-Test einen „Test-Versand"-Button in:
- `admin.reminders.tsx` (pro Reminder-Template)
- `admin.recovery.tsx` (Recovery-Template)

**Wie:**
- Neue Server-Funktion `sendTestEmail` in `src/lib/admin-email-test.functions.ts` (generisch: nimmt `template_name`, `recipient_email`, optional `tenant_id` + Mock-Variablen).
- Rendert Template wie der echte Versand (gleiche Pipeline wie Einladung), Empfänger = aktuelle Admin-Mail, Subject mit `[TEST]` Prefix.
- Button mit Dialog: „An welche Adresse senden? (Standard: deine)" + Tenant-Auswahl.

## 2. HTML-Vorschau für alte E-Mail-Logs (Re-Render)

**Problem:** Alte Logs haben `rendered_html = NULL`.

**Lösung:** Im Vorschau-Modal Fallback:
1. Wenn `rendered_html` vorhanden → direkt anzeigen.
2. Sonst: Server-Funktion `rerenderEmailLog(log_id)` → liest `template_name` + `metadata` (enthält Variablen) + Tenant aus Log, rendert Template **on-the-fly** und zeigt es an (nicht speichern, nur Vorschau).
3. Wenn `metadata` zu dünn ist → Hinweis „Rohdaten nicht verfügbar, Vorschau eingeschränkt" + zeigt Subject + Plain-Text-Body soweit vorhanden.

## 3. `team_leader_id` aus `profiles` entfernen

**Migration `20260605000300_drop_profile_team_leader.sql`:**
```sql
ALTER TABLE public.profiles DROP COLUMN IF EXISTS team_leader_id;
```

**Code-Refactor:**
- `src/hooks/use-team-leader.ts` → liest Leader ausschließlich aus `tenants.team_leader_id` (über User → primary tenant).
- `src/routes/_employee/chat.tsx` → ersetzt `profile.team_leader_id` Query durch `useTeamLeader()`-Hook.
- Suche nach weiteren Referenzen: `rg "team_leader_id" src/` & alle anpassen.

## 4. SMS-Channel: Verbindung testen + Restlaufzeit

**Anosim API checken (Doku):**
- Test-Endpoint: `GET /api/v1/balance` (oder ähnlich) mit API-Key → 200 = OK.
- Nummern-Mietdauer: Anosim liefert beim `rentNumber` Call ein `expires_at`/`endDate` zurück → in `sms_channels.expires_at` speichern.

**UI:**
- In `admin.sms.tsx` Channel-Dialog: Button „Verbindung testen" → ruft `testAnosimConnection({ api_key })` → grünes/rotes Badge + ggf. Account-Balance.
- In Channel-Liste: Badge „Aktiv noch X Tage" (aus `expires_at` berechnet), rot wenn < 3 Tage.

**Migration:** `sms_channels.expires_at timestamptz` hinzufügen (falls noch nicht da).

## 5. Sidebar-Redesign (separater Vorschlag → eigene Runde)

Nach Abschluss von 1–4: ich schicke einen Gruppierungs-Vorschlag mit „was wandert nach `/admin/settings`" zur Freigabe — dann erst umbauen.

## 6. System-Audit (Verbesserungsvorschläge)

Liste schicke ich am Ende dieses Turns im Chat — nach Impact sortiert (Security / UX / Performance / Tech-Debt).

---

## Technische Details

- Alle neuen Migrationen liegen unter `supabase/manual-migrations/` mit Datum `20260605000300+` → User führt am Ende `bash scripts/migrate.sh` auf VPS 1 aus.
- Server-Funktionen liegen in `src/lib/*.functions.ts`, importieren `requireSupabaseAuth` + `supabaseAdmin` nur im Handler.
- Re-Render nutzt vorhandenen Template-Renderer (zu prüfen wo er liegt — vermutlich in der bestehenden Send-Pipeline).
- Anosim-API-Key liegt bereits pro Channel in `sms_channels.api_key` verschlüsselt / plain → klären beim Implementieren.

## Reihenfolge der Umsetzung

1. Migrations-Dateien (3+4)
2. team_leader_id Refactor (3) — am riskantesten, zuerst durch
3. Test-Versand (1)
4. Log Re-Render (2)
5. SMS Test + Restlaufzeit (4)
6. Audit-Liste in Chat
7. Sidebar-Vorschlag in eigener Runde
