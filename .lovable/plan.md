# Plan: Browser-Tab-Titel & Theme-Vereinheitlichung

## Teil 1 — Was heißt „alle 3 Themes vereinheitlichen"?

Aktuell hat jedes Theme einen eigenen Stand. Beispiel:

```text
                       theme-10     theme-tts    theme-privacy
Firmenname             ✅           ✅           ✅
Logo / Farben          ✅           ✅           ✅
Login-URL (portal_url) ✅           ✅           ✅
Telefon im Footer      teilweise    ✅           teilweise
E-Mail im Footer       teilweise    ✅           teilweise
Adresse im Footer      ❌           ✅           ❌
Impressum (HRB,USt-ID) ❌           ✅           ❌
Hero-Titel editierbar  ❌ hart      ✅ Slot      ✅ Slot
Hero-CTAs editierbar   ❌ hart      ✅ Slot      ✅ Slot
Browser-Tab-Titel      hart codiert hart codiert hart codiert
Meta-Description       hart codiert hart codiert hart codiert
```

„Vereinheitlichen" heißt: **gleiche Platzhalter in allen 3 Templates**, damit
jeder Branding-Wert immer überall ankommt — egal welches Theme gewählt wird.

## Teil 2 — Was wird geändert

### A) Browser-Tab-Titel + Meta (NEU im Admin-Tool)

Drei neue Felder im Admin-Generator, die für ALLE Themes gelten:

- **Seitentitel (Browser-Tab)** — z.B. „DGI GmbH — Beratung & Datenschutz"
- **Meta-Beschreibung** — 1–2 Sätze für Google-Suchergebnis
- **OG-Bild URL** (optional) — Vorschaubild für WhatsApp/LinkedIn/Facebook

Diese Werte werden als `{{seo_title}}`, `{{seo_description}}`, `{{seo_image}}`
in den `<head>` aller 3 Templates eingesetzt:

```html
<title>{{seo_title}}</title>
<meta name="description" content="{{seo_description}}" />
<meta property="og:title" content="{{seo_title}}" />
<meta property="og:description" content="{{seo_description}}" />
<meta property="og:image" content="{{seo_image}}" />
<link rel="canonical" href="https://{{landing_domain}}/" />
```

Default-Werte werden automatisch aus Firmenname + Theme-Typ vorbelegt
(„{{firmenname}} — Strategische Beratung" etc.), können aber überschrieben werden.

### B) Branding-Felder überall ausgeben

In allen 3 Templates wird der Footer auf den gleichen Block vereinheitlicht
mit folgenden Platzhaltern:

```text
{{firmenname}}            Telefon: {{telefon}}
{{strasse}}               E-Mail:  {{email}}
{{plz}} {{stadt}}         WhatsApp: {{whatsapp_number}}

Impressum:
Geschäftsführer: {{geschaeftsfuehrer}}
HRB {{hrb}}, {{registergericht}}
USt-ID: {{ust_id}} · Steuernummer: {{steuernummer}}
```

So sind Kontakt + Impressum in jedem Theme identisch befüllt.

### C) theme-10 bekommt Inhalts-Slots wie die anderen

theme-10 hat aktuell hart codierte Hero-Texte. Wir fügen die gleichen Slot-Keys
hinzu wie bei theme-tts-consultant, damit das Admin-Tool den Theme-Editor
auch hier zeigt:

- `hero_kicker`, `hero_title`, `hero_subtitle`
- `hero_cta_primary`, `hero_cta_secondary`
- `nav_label_*` (optional, falls Navi-Labels änderbar sein sollen)

## Teil 3 — Was bleibt unverändert

- Theme-spezifische Strukturen (Pakete, Steps, Trust-Badges) bleiben
  individuell — nicht alle Themes brauchen die gleichen Sektionen.
- Farben, Logo, Favicon, Bewerbungsflow (Klassisch/Fast-Track),
  Portal-Login — funktionieren bereits einheitlich.

## Teil 4 — Technische Details (für später)

Dateien, die angepasst werden:

1. `src/lib/landing-generator.functions.ts`
   - `BrandingSchema` erweitern: `seo_title`, `seo_description`, `seo_image`
2. `src/lib/landing-themes.ts` — keine Änderung an der Struktur
3. `src/landing-themes/theme-10/`
   - `meta.json`: Slots-Array hinzufügen (Hero + CTA)
   - `template.html`: `<title>`, Meta-Tags, Hero, Footer auf Platzhalter umstellen
4. `src/landing-themes/theme-tts-consultant/template.html`
   - `<head>`-Meta-Tags auf `{{seo_*}}` umstellen
5. `src/landing-themes/theme-privacy-guardian/template.html`
   - `<head>`-Meta-Tags + Footer auf gemeinsamen Block
   - Impressum-Felder ergänzen
6. `src/routes/admin.landing-generator.tsx`
   - 3 neue Eingabefelder (Seitentitel, Beschreibung, OG-Bild)
   - Auto-Vorbelegung aus Firmenname

## Ergebnis

- ✅ Browser-Tab-Titel pro Landing-Page individuell setzbar
- ✅ Google-Suchergebnis + Social-Sharing-Vorschau steuerbar
- ✅ Alle Kontakt- & Impressum-Daten in jedem Theme automatisch
- ✅ theme-10 bekommt den gleichen Inhalts-Editor wie die anderen
