## Befund — was funktioniert ✅

- Alle 3 Themes (`theme-10`, `theme-tts-consultant`, `theme-privacy-guardian`) nutzen einheitlich `{{seo_title}}`, `{{seo_description}}`, `{{landing_domain}}`, `{{seo_image}}` in `<head>` (Title, Meta-Desc, OG-Tags, Twitter-Card, Canonical, Apple-Touch-Icon).
- Pflichtfeld-Check für Firmenname / E-Mail / API-Endpoint vorhanden.
- SEO-Auto-Defaults (`firmenname` → Titel/Description) greifen sowohl in Live-Preview als auch beim ZIP-Generieren.
- `injectLandingConfig()` setzt `window.PORTAL_API/TENANT_ID/FLOW_TYPE/WHATSAPP_NUMBER` korrekt in jedes generierte HTML.
- Theme-Slots (`hero_kicker`, `hero_title`, …) sind in allen 3 Themes durchgängig verdrahtet.

## Befund — kleine Probleme ⚠️

1. **Leere `landing_domain` erzeugt kaputte URLs:** Templates rendern `https:///` als Canonical & `og:url`, wenn das Feld leer bleibt. → Suchmaschinen + Social-Previews kaputt.
2. **Leeres `seo_image` erzeugt leeres OG-Tag:** `<meta property="og:image" content="">` — kein Crash, aber unsauber. Sollte komplett weggelassen werden, wenn leer.
3. **API-Endpoint-Placeholder ist verwirrend:** Die UI schlägt `https://{landing_domain}/api/public/applications` vor. Korrekt ist aber `https://api.mb-portal.com/api/public/applications` (zentrales Backend, nicht die Landing-Domain).
4. **Favicon nicht hochgeladen → Link ins Leere:** Templates verweisen immer auf `assets/favicon.png`. Wenn der User kein Favicon hochlädt, ist die Datei nicht im ZIP → 404 im Browser-Tab.

## Plan — was wir ändern

### 1. `landing_domain` als Pflichtfeld
- `src/routes/admin.landing-generator.tsx`: 
  - Label → „Landing-Domain *"
  - Validation in `handleGenerate`: Toast „Landing-Domain ist Pflicht (für SEO/Canonical)".
- `src/lib/landing-generator.functions.ts`: Zod-Schema `landing_domain: z.string().min(1)`.
- Im Generator-Code: `landing_domain` automatisch von `https://` / Trailing-Slash bereinigen (User-Komfort).

### 2. Leere OG-/Canonical-Tags abfangen
- `src/lib/landing-generator.functions.ts` — neue Helper-Funktion `cleanEmptyMetaTags(html)` läuft nach `applyPlaceholders`:
  - Entfernt `<meta property="og:image" content="">`-Zeilen, wenn `seo_image` leer.
  - Entfernt Canonical/og:url, wenn `landing_domain` leer (Belt-and-braces nach Punkt 1).
- Gleiche Logik im Preview (`previewSrcDoc`) anwenden.

### 3. API-Endpoint-Placeholder fixen
- `src/routes/admin.landing-generator.tsx` Zeile 267-269: Default-Placeholder ändern zu:
  ```
  https://api.mb-portal.com/api/public/applications
  ```
  (statt von `landing_domain` abzuleiten).
- Hilfetext unter dem Feld ergänzen: „Zentrales Backend für alle Kunden — kein Tippen auf die Landing-Domain."

### 4. Favicon-Fallback
- `src/lib/landing-generator.functions.ts`: Wenn `faviconDataUrl` nicht gesetzt ist → 1×1 PNG-Platzhalter unter `assets/favicon.png` ins ZIP legen (analog zu Logo-Fallback). Verhindert 404 + Browser-Console-Warning.

## Geänderte Dateien

- `src/lib/landing-generator.functions.ts` (Validation, Helper, Favicon-Fallback)
- `src/routes/admin.landing-generator.tsx` (Pflichtfeld-Label + Validation, API-Placeholder, Preview-Cleaning)

## Was wir NICHT ändern

- Themes-HTML/CSS/JS bleiben unverändert — alle Fixes laufen über den Generator + Preview-Layer.
- Kein Refactoring der Slot-Struktur — funktioniert bereits korrekt.

Nach diesen 4 Fixes ist die Generierung wasserdicht — egal welches Theme oder welche Kombination an Feldern.
