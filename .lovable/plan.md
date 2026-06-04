## Ziel

Nach einem Primary-Domain-Wechsel sollen **alle** Personen eines Tenants (Mitarbeiter + akzeptierte Bewerber) zuverlässig auf die neue Portal-Adresse umgelenkt werden — über Recovery-Mails **und** über einen Hinweis-Banner in jeder regulären Reminder-Mail der nächsten 30 Tage. Strikte Tenant-Isolation: Tenant A erfährt nichts von Domain-Wechseln in Tenant B.

## Umfang (5 Punkte)

### 1. Domain-Wechsel-Banner in allen Reminder-Mails (30-Tage-Fenster)
- In `supabase/functions/send-reminders/index.ts` beim Aufbau jeder Mail (alle Reminder-Typen: invite, confirm_email, complete_registration, missing_data, etc.) prüfen:
  - Lade `tenants.primary_domain_changed_at` für den Tenant des Empfängers.
  - Wenn `< 30 Tage` her: Banner oberhalb des Body-Inhalts rendern.
- Banner-Inhalt (deutsch, neutral):
  > **Hinweis: Unsere Portal-Adresse hat sich geändert.** Bitte nutze ab sofort `https://portal.<neue-domain>/login`. Ältere Links funktionieren möglicherweise nicht mehr.
- Styling konsistent zum bestehenden Mail-Layout (gelber/oranger Hintergrund, kein neuer Template-Typ).
- Tenant-Isolation: Banner-Lookup geht ausschließlich über `profiles.tenant_id` → `tenants.primary_domain_changed_at`. Kein globaler Flag.

### 2. Akzeptierte Bewerber bei Domain-Recovery einbeziehen
- Aktuell schließt `getAffectedRecipients` und die Edge-Function Bewerber komplett aus.
- Neu: Bewerber mit `applications.status = 'accepted'` (oder gleichwertig — Status anhand bestehender Logik prüfen) werden in den Recovery-Lauf aufgenommen. Nicht-akzeptierte Bewerber bleiben außen vor.
- `kind: "bewerber_akzeptiert"` als dritter Empfängertyp neben `mitarbeiter`. In der UI als eigenes Badge sichtbar.
- Tenant-Filter bleibt: `applications.tenant_id = :tenant_id`.

### 3. Recovery-Mail-Vorschau in `/admin/recovery`
- Aktuell liegt der Recovery-Body in `tenants.reminder_recovery_subject/body` ohne UI-Vorschau.
- Neuer Tab/Bereich in `/admin/recovery`: **Vorschau** mit
  - Subject-Zeile,
  - gerendertem HTML (Platzhalter `{{first_name}}`, `{{portal_link}}`, `{{tenant_name}}` mit Beispieldaten ersetzt),
  - Hinweis „So sieht die Mail für deine Empfänger aus".
- Optional als Folgearbeit: gleiche Vorschau-Komponente in `/admin/email-templates` einbauen (außerhalb dieses Plans, nur erwähnt).

### 4. Per-Empfänger Recovery-Status in `/admin/recovery`
- Aktuell zeigt die UI nur Aggregat-Zahlen (`X gesendet, Y übersprungen, Z fehlgeschlagen`).
- Neu: Empfängerliste mit Status-Spalte je Person:
  - ✅ **gesendet** (Zeitstempel)
  - ⏳ **in Queue** (noch nicht durch Cron gelaufen)
  - ⏭ **übersprungen** (Grund: Quiet Hours / kein E-Mail / deaktiviert)
  - ❌ **fehlgeschlagen** (Fehlertext aus `reminder_log.error`)
- Datenquelle: `reminder_log` gefiltert auf `reminder_type='domain_recovery'` AND `created_at >= tenants.primary_domain_changed_at`. So sieht jeder Lauf nur die für den aktuellen Wechsel relevanten Einträge.
- Sortierung: Fehlgeschlagene zuerst, dann ausstehend, dann gesendet.

### 5. „Nur Fehlgeschlagene erneut senden"-Button
- Neben dem bestehenden „Recovery-Mails jetzt senden" ein zweiter Button: **„Fehlgeschlagene erneut senden"**.
- Auf Edge-Function-Seite neuer Mode-Parameter `retry_failed_only: true` → liest Empfänger aus `reminder_log` mit `status='failed'` seit `primary_domain_changed_at` und versendet nur an diese.
- Idempotenz-Anker (`reminder_log`-Eintrag pro Empfänger pro Wechsel) wird vor dem Retry für die fehlgeschlagenen Einträge zurückgesetzt.

## Tenant-Isolation (Querschnittsregel)

Alle vier Datenpfade sind tenant-scoped — keine Änderung daran, nur zur Sicherheit dokumentiert:

| Pfad | Filter |
|---|---|
| Banner-Lookup | `profiles.tenant_id` → `tenants.primary_domain_changed_at` des Empfängers |
| Recovery-Empfängerliste | `profiles.tenant_id = :tenant_id` UND `applications.tenant_id = :tenant_id` |
| Portal-Link-Generierung | `tenants.primary_domain` des Tenants des Empfängers |
| Recovery-Status-Log | `reminder_log.tenant_id` gefiltert |

→ Tenant `portal.neu.de` sieht keine Daten aus Tenant `portal.alt.de`, sein Banner-Flag bleibt unangetastet, seine Mitarbeiter erhalten keine fremden Recovery-Mails.

## Technische Details (Codebase-Anker)

- **Banner**: `supabase/functions/send-reminders/index.ts` — Helper-Funktion `renderDomainChangeBanner(tenant)` einbauen, in allen Template-Rendern oberhalb des Bodys einsetzen.
- **Akzeptierte Bewerber**: `src/lib/tenant-domains.functions.ts` → `getAffectedRecipients` um Query auf `applications` mit `status='accepted'` erweitern. Edge-Function `send-reminders/index.ts` Mode `domain_recovery` analog erweitern.
- **Vorschau**: neue Server-Function `renderRecoveryPreview` in `src/lib/tenant-domains.functions.ts`, ruft das gleiche Render wie die Edge-Function mit Demo-Daten. UI in `src/routes/admin.recovery.tsx` als Tab oder Card.
- **Per-Empfänger-Status**: neue Server-Function `getRecoveryStatus(tenant_id)` liefert pro Empfänger den letzten `reminder_log`-Eintrag seit `primary_domain_changed_at`. UI: Tabelle unterhalb der „Betroffene Mitarbeiter"-Card.
- **Retry-Failed**: `enqueueDomainRecoveryMails` um `retry_failed_only: boolean` erweitern, an Edge-Function durchreichen.

## Was bewusst NICHT im Plan ist

- **301-Redirect auf alter Domain**: nicht möglich, wenn Domain gesperrt ist (User-Feedback).
- **SMS-Fallback**: nicht möglich (SMS nur Empfang, kein Versand).
- **Auto-Trigger bei Domain-Down**: bewusst nicht — Down-Erkennung ist unzuverlässig, Aktivierung bleibt manuell.
- **Vorschau in `/admin/email-templates`**: separate Aufgabe, später.

## Reihenfolge der Umsetzung

1. Banner-Helper in `send-reminders` + Render in allen Templates (Punkt 1).
2. Akzeptierte Bewerber in Recovery-Empfängerliste + Edge-Function (Punkt 2).
3. Per-Empfänger-Status-Tabelle in `/admin/recovery` (Punkt 4).
4. Recovery-Vorschau-Tab in `/admin/recovery` (Punkt 3).
5. Retry-Failed-Only-Button (Punkt 5).
