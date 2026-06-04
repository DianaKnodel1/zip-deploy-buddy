# Plan: Bugfixes & Verbesserungen Reminder / Delete / KYC / Uploads

## 1. Mitarbeiter-Löschen schlägt fehl („Nicht autorisiert")

**Problem:** `admin_delete_user_cascade` prüft `has_role(auth.uid(), 'admin')`. Wir rufen die RPC über `supabaseAdmin` (service_role) auf → `auth.uid()` ist `NULL` → Exception.

**Fix:**
- RPC-Signatur um `_actor_id uuid` erweitern; Auth-Check gegen `_actor_id` statt `auth.uid()`.
- `src/lib/admin-delete.functions.ts`: `_actor_id: context.userId` mitgeben.
- Migration: `supabase/manual-migrations/20260604200000_admin_delete_actor.sql`.

## 2. Janina-Reminder (Bewerber bekommt „Keine Buchung 7+ Tage")

**Diagnose:** Der Filter `no_recent_booking` (Zeile 451) prüft nur `onboarding_status='abgeschlossen'`. Bei Janina ist `profile.status='registriert'` (nicht `angenommen`) — sie ist also formal kein aktiver Mitarbeiter, hat aber irgendwie `onboarding_status='abgeschlossen'`.

**Fix in `send-reminders/index.ts` `runNoRecentBooking`:**
- Zusätzlich `profile.status = 'angenommen'` voraussetzen.
- Damit gehen „Keine Buchung"-Mails nur noch an formal angenommene + onboarding-abgeschlossene Mitarbeiter.

Zusätzlich Audit: einmaligen Check schreiben, der inkonsistente Profile listet (`onboarding_status='abgeschlossen'` aber `status != 'angenommen'`).

## 3. Uploads: „Unbekannt" nach Mitarbeiter-Löschung

Sobald (1) gefixt ist, löscht die Cascade-RPC `documents`, `task_submissions`, `kyc_verifications` automatisch (FK auf `auth.users` ON DELETE CASCADE existiert teils, sonst über die dynamische FK-Schleife).

**Zusätzlich in `admin-delete.functions.ts`:**
- Vor Auth-Delete explizit aus Storage-Buckets `kyc-documents`, `documents`, `task-submissions` alle Dateien mit Pfad-Präfix `<user_id>/` entfernen, damit keine Karteileichen bleiben.
- Bestätigen: Uploads-Übersicht filtert dann automatisch (kein Profil + keine Submission/Document mehr = keine Zeile).

## 4. KYC-Prüfung: Performance + Lightbox

**Performance (Bilder rendern langsam):**
- `admin.kyc.tsx`: SignedUrls **parallel** laden (`Promise.all`) statt sequentiell in der `for`-Schleife → spart ~2× Latenz.
- TTL der Signed URLs auf 1 h, damit Re-Renders nicht jedes Mal neu signieren.
- React-State-Cache (`Map<kycId, urls>`) — beim Wechsel zwischen Prüfungen sofortige Anzeige, wenn schon geladen.
- `<img loading="eager" decoding="async">` für die drei sichtbaren Bilder.

**Lightbox (Doppelklick = Vollbild):**
- Neue kleine Komponente `KycImageLightbox` (Radix-Dialog, schwarzer Hintergrund, Bild zentriert, ESC schließt).
- `onDoubleClick` auf jedem KYC-Bild öffnet die Lightbox mit dem jeweiligen Bild.
- Optional Pfeiltasten zwischen den drei Dokumenten (Vorderseite / Rückseite / Selfie).

## 5. Domain-Recovery UI-Text korrigieren

Den veralteten Text auf `/admin/recovery` an die tatsächliche Logik anpassen (max. 20 Mails/Cron-Lauf, ausgeschlossene Status, getrennte Tenants).

---

## Technische Details

**Migration (Auszug):**
```sql
CREATE OR REPLACE FUNCTION public.admin_delete_user_cascade(
  _user_id uuid, _actor_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(_actor_id, 'admin') THEN
    RAISE EXCEPTION 'Nicht autorisiert';
  END IF;
  -- … bestehende Logik …
END $$;
```

**Reminder-Filter (`runNoRecentBooking`):**
```ts
.eq("onboarding_status", "abgeschlossen")
.eq("status", "angenommen")              // NEU
.not("status", "in", "(deaktiviert,abgelehnt,gesperrt)")
```

**KYC-Loader parallel:**
```ts
const entries = await Promise.all(
  (["id_front_url","id_back_url","selfie_url"] as const)
    .filter(f => kyc[f])
    .map(async f => {
      const { data } = await supabase.storage.from("kyc-documents")
        .createSignedUrl(kyc[f]!, 3600);
      return [f, data?.signedUrl] as const;
    })
);
```

## Reihenfolge
1. Cascade-Delete-Fix (Migration + Server-Fn) — kritisch
2. Reminder-Filter erweitern + Audit-Log
3. Uploads-Storage-Cleanup
4. KYC-Performance + Lightbox
5. Recovery-UI-Texte

WhatsApp-Bot kommt im nächsten Block, wie besprochen. Deployment erst nach Abschluss.
