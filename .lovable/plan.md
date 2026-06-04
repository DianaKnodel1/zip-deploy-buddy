# Großes Admin-Update

## 1. Manueller Arbeitsvertrag pro Mitarbeiter

**Wo:** `/admin/employees/{userId}` → neuer Tab/Card „Arbeitsvertrag".

**Zwei Modi (Admin wählt):**
- **Editor-Modus:** HTML/Rich-Text-Editor vorausgefüllt mit der aktuellen Tenant-Vorlage + ersetzten Platzhaltern (Name, Adresse etc.). Admin ändert frei. Speichern → individuelle Version für diesen Mitarbeiter.
- **PDF-Upload-Modus:** Admin lädt fertiges PDF hoch.

**Was passiert beim Speichern:**
- Neue Tabelle `employee_contract_overrides` (user_id, tenant_id, html_body NULL, pdf_url NULL, created_by, created_at).
- `profiles.contract_signed_at` wird auf NULL gesetzt → Mitarbeiter sieht beim nächsten Login die Vertrags-Seite (existiert schon via `requestContractResign`).
- Vertrags-Seite (`/contract`) prüft zuerst auf Override → zeigt diesen statt der Tenant-Standardvorlage. Nach Unterschrift wandert das signierte PDF wie gewohnt in `contracts` + `documents`.

**Wo landet der unterschriebene Vertrag:** wie bisher – Mitarbeiter-Dokumente + Admin `/admin/contracts`. Nur der Quell-Body ist diesmal der Override.

## 2. Admin-Chat aufräumen

**Auf `/admin/chat`:**
- **Tenant-Tabs oben:** „Alle | Tenant A | Tenant B | …" (aus den Tenants des Mitarbeiters). Filtert die Conversation-Liste.
- **Soft-Delete pro Chat:** Button im Conversation-Header → `chat_conversations.admin_hidden_at = now()`. Versteckt aus der Liste.
- **Auto-Reappear:** Wenn der Mitarbeiter danach eine neue Nachricht schickt, setzt ein Trigger `admin_hidden_at = NULL` → Chat erscheint wieder oben.
- **Klick auf Initialen** im Chat-Header → `navigate('/admin/employees/{userId}')`.

**Migration:** `chat_conversations.admin_hidden_at timestamptz` + Trigger auf `chat_messages` Insert.

## 3. Mail-Vorschau + Test-Versand

**Auf `/admin/email-logs`:**
- Klick auf Zeile → Modal mit gerendertem HTML (iframe-sandbox), plus Header-Block: Absender, Tenant, Domain, Betreff, Status, Empfänger, Zeitpunkt, Fehlertext.
- Speichern wir bereits `html_body` in `email_send_log`? Falls nicht → Spalte `rendered_html` ergänzen und beim Enqueue mitschreiben.

**Test-Versand-Button („An mich senden"):**
- Auf `/admin/email-templates` (Reminder-Templates)
- Auf `/admin/recovery` (Domain-Recovery-Template)
- Beim „Bewerbung annehmen"-Dialog in `/admin/applications/{appId}` (Vorschau + „Test an mich" vor „Senden")
- Funktion `sendTestEmail({ template, tenantId, recipient })` → rendert mit Test-Daten + tatsächlichem Absender des gewählten Tenants → schickt an die E-Mail des eingeloggten Admins. Eintrag in `email_send_log` mit `metadata.test=true`.

## 4. Admin-Sidebar gruppiert

Umbau `src/components/AdminLayout.tsx` mit `SidebarGroup` + `SidebarGroupLabel`:

```
PERSONEN
  Dashboard, Bewerbungen, Mitarbeiter, KYC, Verträge
AUFTRÄGE
  Aufträge, Prüfungen, Nachbesserungen, Uploads, Termine
KOMMUNIKATION
  Chat, SMS, Post, E-Mail-Logs, Erinnerungen, Recovery
FINANZEN
  Transaktionen
SYSTEM
  Landing Pages, Domains, Protokoll, Einstellungen
```

Badges (Bewerbungen 99+, KYC 5) bleiben unverändert.

## 5. Domain-Failover-Doku im Portal

Kleiner Hilfe-Hinweis auf `/admin/domains` (Aufklapper „Was tun wenn Domain ausfällt?"):
1. Alias-Domain als „Primary Domain" setzen → Speichern.
2. System schickt automatisch Recovery-Mails über die neue Domain.
3. Voraussetzung: Alias war vorher schon DNS-verifiziert.

Keine Code-Änderung am Failover-Mechanismus selbst – nur UX-Hilfe.

---

## Technische Details

**Migrationen (manual-migrations):**
- `20260605000000_employee_contract_overrides.sql` – Tabelle + Grants + RLS (admin only).
- `20260605000100_chat_admin_hidden.sql` – Spalte `admin_hidden_at` + Trigger.
- `20260605000200_email_log_html.sql` – Spalte `rendered_html` falls fehlend.

**Neue/geänderte Files:**
- `src/lib/employee-contract-override.functions.ts` (save/load/delete Override)
- `src/routes/admin.employees.$userId.tsx` (neuer Vertrags-Tab mit Editor + Upload)
- `src/routes/_employee/contract.tsx` (Override-Check vor Standardvorlage)
- `src/routes/admin.chat.tsx` (Tenant-Tabs, Hide-Button, Initialen-Link)
- `src/lib/chat-admin.functions.ts` (hideConversation)
- `src/routes/admin.email-logs.tsx` (Detail-Modal mit iframe)
- `src/lib/email-test.functions.ts` (sendTestEmail)
- `src/routes/admin.email-templates.tsx` + `admin.recovery.tsx` + `admin.applications.$appId.tsx` (Test-Buttons)
- `src/components/AdminLayout.tsx` (Sidebar-Gruppen)
- `src/routes/admin.domains.tsx` (Hilfe-Aufklapper)

**Was NICHT geändert wird:**
- SMS-Polling-Code (steht schon, wird beim nächsten Deploy live getestet)
- Bestehende Vertrags-PDF-Generierung
- Mailversand-Pipeline selbst (nur Vorschau + Test-Trigger neu)

**Reihenfolge:** Migrationen → Sidebar (schnell, sichtbar) → Mail-Vorschau & Test → Chat-Aufräumen → Vertrags-Override → Domains-Hilfe.
