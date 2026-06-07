## Looping / Reload-Bug (höchste Priorität)

**Diagnose:** `src/contexts/AuthContext.tsx` ruft bei JEDEM `onAuthStateChange`-Event `applySession` auf — inklusive `INITIAL_SESSION` (bei jedem Mount) und `TOKEN_REFRESHED` (Tab-Fokus, ~stündlich). Das setzt `session`-State neu → komplette App rerendert → Queries/Realtime-Subscriptions (FloatingChat, AdminData, use-admin-badges) bauen sich neu auf → kurzer Spinner überall. Genau dein Symptom: „Daten neu geladen, alle paar Sekunden, auf jeder Route".

**Fix:**
1. In `AuthContext` Events filtern: nur bei `SIGNED_IN`, `SIGNED_OUT`, `USER_UPDATED` reagieren. `TOKEN_REFRESHED` / `INITIAL_SESSION` ignorieren (Session-Restore läuft schon über `getSession()`).
2. `checkAdminRole` cachen: nur neu prüfen, wenn `user.id` sich tatsächlich ändert (nicht bei jedem Token-Refresh).
3. Zusätzlich in `FloatingChat.tsx` + `admin.chat.tsx`: prüfen, dass `useEffect`-Deps stabil sind (keine Objekte/Funktionen die jedes Render neu erzeugt werden → würden Channel-Resubscribe-Loop auslösen).

## Erklärungen (keine Code-Änderung)

**Sender-Domain-Banner:** Live-Check in `/admin/tenants` Edit-Dialog — `sender_email`-Domain muss zu `domain`, `primary_domain` oder einem `domain_aliases`-Eintrag passen. Wenn nicht → roter Hinweis „passt nicht, Mails landen wahrscheinlich im Spam". Wichtig nach `.de → .com`-Wechsel: alte `sender_email@…de` würde sonst unbemerkt schlechte Deliverability haben.

**SMTP-Test:** dein vorhandener `TestEmailButton` reicht — sendet via Tenant-SMTP eine Test-Mail. Kein neuer Code nötig.

## Härtung Email — Bounce-Suppression (wie gewünscht)

1. **Migration** `supabase/manual-migrations/20260608000000_bounce_suppression.sql`:
   - Spalte `bounce_count int default 0` in `email_send_log` (falls nicht da).
   - Trigger: bei `status='bounce'` zähle pro Empfänger; bei 3+ → Insert in `suppressed_emails` (Tabelle existiert bereits laut email-infrastructure-guide).
2. **Send-Pfad** (`send-reminders`, `send-password-reset`, `send-signup-confirmation`): vor jedem Send `select 1 from suppressed_emails where email=… and tenant_id=…` → wenn vorhanden, skip + log `skipped: suppressed`.
3. **Admin-UI** (`admin.email-logs.tsx`): Filter „Nur gesperrte", Button „Sperre aufheben" pro Adresse.

## Reihenfolge der Umsetzung
1. **Auth-Loop-Fix** (1 Datei, kritischer Bug)
2. **Bounce-Suppression** (Migration + 3 Edge-Functions + UI-Filter)

## Zu ändernde Dateien
- `src/contexts/AuthContext.tsx` — Event-Filter, Admin-Cache
- `src/components/FloatingChat.tsx` — Deps-Stabilisierung prüfen
- `src/routes/admin.chat.tsx` — dito
- `supabase/manual-migrations/20260608000000_bounce_suppression.sql` *(neu)*
- `supabase/functions/send-reminders/index.ts` — Suppression-Check
- `supabase/functions/send-password-reset/index.ts` — Suppression-Check
- `supabase/functions/send-signup-confirmation/index.ts` — Suppression-Check
- `src/routes/admin.email-logs.tsx` — Filter + Unblock-Button

## Was wir NICHT machen
- Resend-Button, SMTP-Audit-Trail, Domain-Wechsel-Wizard (waren nicht ausgewählt — können danach folgen).

Soll ich loslegen?
