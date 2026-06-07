# Plan: E-Mail-Härtung + Landing-Modul fertigbauen

## Teil 1 — E-Mail-Härtung (klein, 1 Schritt)

### A) Sender-Domain-Mismatch-Warner
Im Tenant-Edit-Dialog (`/admin/tenants`): wenn `sender_email`-Domain weder zu `domain`, `primary_domain` noch zu `domain_aliases` passt → roter Banner „Sender-Domain passt nicht zur Tenant-Domain — Mails landen wahrscheinlich im Spam". Nur Warnung, kein Block (manche nutzen bewusst Subdomain wie `mail.…`).

### B) SMTP-Health-Check-Button
Neue Server-Funktion `testTenantSmtp({ tenantId, recipient })`:
- lädt Tenant per ID
- baut nodemailer-Transport mit `tenant.smtp_*`
- sendet kurze Test-Mail („SMTP-Test von …")
- loggt in `email_send_log` mit `template_name='smtp_test'`
- Response: `{ ok, error? }`

Button im Tenant-Edit-Dialog: „Test-Mail senden an…" + Empfänger-Eingabe.

---

## Teil 2 — Landing-Page-Modul ausbauen

### C) Live-Preview pro Theme (Iframe mit Branding live gerendert)
- Auf `/admin/landing-generator`: pro Theme-Karte ein „Vorschau"-Button → öffnet Sheet mit Iframe.
- Neue Server-Route `src/routes/api/public/landing-preview.$themeId.tsx` (GET): rendert HTML aus Theme + Branding-Query-Params (`?firmenname=…&primary_color=…&tenant_id=…`) und gibt komplettes HTML als Response zurück.
- Iframe-Quelle: `/api/public/landing-preview/{themeId}?…branding…`
- Live-Update: bei Input-Change im Branding-Form → Iframe-`src` neu setzen (debounced 400ms).

### D) Theme-Editor (Texte/Bilder pro Theme im UI editierbar)
Aktuell sind alle Texte/Bilder hart in `template.html`. Statt jedem Theme einzeln eine UI zu bauen → **Slot-System**:
- Jedes `template.html` bekommt Platzhalter im Mustache-Stil: `{{hero_title}}`, `{{hero_subtitle}}`, `{{cta_label}}`, `{{stat_1_value}}`, `{{stat_1_label}}`, `{{testimonial_1_text}}`, `{{hero_image_url}}` etc.
- Jedes `meta.json` bekommt neues Feld `slots: [{ key, label, type: 'text'|'longtext'|'image'|'color', default }]`. Editor rendert Form dynamisch aus dieser Liste.
- `landing-generator.functions.ts`: ersetzt `{{key}}` mit Slot-Werten (zusätzlich zu bestehender Branding-Ersetzung).
- Im UI: zweite Section „Inhalte" — Felder gemäß `slots[]` des gewählten Themes. Werte fließen in Preview + ZIP-Generierung.
- Erste Iteration: nur **theme-02** vollständig „slotifizieren" als Referenz. Weitere Themes folgen nach Review (du sagst welche zuerst).

### E) Bewerbungsformular → `/api/public/applications` + Tenant-Auto-Zuordnung
- In jedem Theme-`script.js`: Formular-Submit POSTet bereits an `branding.api_endpoint`. ✓
- Sicherstellen, dass `tenant_id` aus Branding mitgesendet wird (in einigen Themes evtl. nicht im Submit-Payload). 
- `landing-generator.functions.ts` schreibt `window.__LANDING_CONFIG__ = { api_endpoint, tenant_id, portal_url, flow_type }` ins HTML; alle Themes lesen daraus.
- Server-Route `/api/public/applications` ist schon korrekt und persistiert mit `tenant_id` → die spätere Reminder-/Accept-Mail nutzt automatisch nur den richtigen Tenant-SMTP.

---

## Technische Details

### Geänderte/neue Dateien
**Härtung:**
- `src/routes/admin.tenants.tsx` — Mismatch-Banner + Test-Button + Empfänger-Input
- `src/lib/tenant-smtp-test.functions.ts` *(neu)* — `testTenantSmtp` server fn (nutzt `supabaseAdmin` + nodemailer; läuft im Worker — falls nodemailer im Worker Probleme macht: per Edge Function statt server fn)

**Wenn nodemailer im Worker nicht läuft (üblicher Stolperstein bei TanStack/CF):** stattdessen neue Edge Function `supabase/functions/send-smtp-test/index.ts` analog zu `send-password-reset`.

**Landing-Modul:**
- `src/landing-themes/theme-02/template.html` — Platzhalter einbauen
- `src/landing-themes/theme-02/meta.json` — `slots[]` ergänzen
- `src/lib/landing-themes.ts` — `ThemeFiles` um `slots` erweitern
- `src/lib/landing-generator.functions.ts` — Slot-Replacement + `window.__LANDING_CONFIG__`-Injection
- `src/routes/api/public/landing-preview.$themeId.ts` *(neu)* — Preview-Renderer
- `src/routes/admin.landing-generator.tsx` — Slot-Editor-Section, Preview-Iframe, „Vorschau"-Button pro Theme-Karte
- Alle `script.js`: aus `window.__LANDING_CONFIG__` lesen statt hartem Endpoint

### Was NICHT in diesem Schritt
- Theme-Editor nur für theme-02 vollständig. Themes 03–10 bekommen `slots: []` (= keine Editor-Felder, nur Branding-Ersetzung wie bisher). Nach Review entscheidest du, welches Theme als nächstes „slotifiziert" wird.
- One-Click-Deploy (war nicht ausgewählt) → bleibt ZIP-Download.

### Manuelle Schritte nach Deploy
Keine Migration. Falls Edge Function für SMTP-Test: `supabase functions deploy send-smtp-test --no-verify-jwt`.

---

## Reihenfolge der Umsetzung
1. E-Mail-Härtung (A + B) — kleinste Einheit
2. Landing Live-Preview-Route + Iframe (C)
3. Slot-System + theme-02 slotifizieren (D)
4. `window.__LANDING_CONFIG__`-Injection + alle scripts.js anpassen (E)

Ich liefere das in einer Antwort. Soll ich loslegen?
