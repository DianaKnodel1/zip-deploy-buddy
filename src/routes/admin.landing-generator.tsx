import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { generateLandingZip } from "@/lib/landing-generator.functions";
import { THEME_LIST, THEMES } from "@/lib/landing-themes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Download, Globe, Loader2, CheckCircle2, Eye, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/landing-generator")({
  component: LandingGeneratorPage,
});

type Branding = {
  firmenname: string;
  primary_color: string;
  secondary_color: string;
  whatsapp_number: string;
  email: string;
  telefon: string;
  telefon_2: string;
  strasse: string;
  plz: string;
  stadt: string;
  hrb: string;
  registergericht: string;
  ust_id: string;
  steuernummer: string;
  geschaeftsfuehrer: string;
  impressum: string;
  landing_domain: string;
  api_endpoint: string;
  portal_url: string;
  supabase_url: string;
  supabase_anon_key: string;
  tenant_id: string;
  flow_type: "classic" | "fast";
  seo_title: string;
  seo_description: string;
  seo_image: string;
};

const EMPTY: Branding = {
  firmenname: "",
  primary_color: "#2563eb",
  secondary_color: "#1e40af",
  whatsapp_number: "",
  email: "",
  telefon: "",
  telefon_2: "",
  strasse: "",
  plz: "",
  stadt: "",
  hrb: "",
  registergericht: "",
  ust_id: "",
  steuernummer: "",
  geschaeftsfuehrer: "",
  impressum: "",
  landing_domain: "",
  api_endpoint: "",
  portal_url: "",
  supabase_url: "",
  supabase_anon_key: "",
  tenant_id: "",
  flow_type: "classic",
  seo_title: "",
  seo_description: "",
  seo_image: "",
};

function LandingGeneratorPage() {
  const { toast } = useToast();
  const generate = useServerFn(generateLandingZip);

  const [themeId, setThemeId] = useState<string>(THEME_LIST[0]?.id ?? "");
  const [branding, setBranding] = useState<Branding>(EMPTY);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [faviconDataUrl, setFaviconDataUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastFile, setLastFile] = useState<string | null>(null);
  // Slot-Werte pro Theme — bei Theme-Wechsel mit Defaults vorbelegen.
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const currentTheme = THEME_LIST.find((t) => t.id === themeId);
  const currentSlots = currentTheme?.slots ?? [];
  // Bei Theme-Wechsel Slot-Defaults laden (überschreibt vorhandene Werte nicht).
  const lastThemeRef = useRef<string>("");
  if (themeId && lastThemeRef.current !== themeId) {
    lastThemeRef.current = themeId;
    const defaults: Record<string, string> = {};
    for (const s of currentSlots) defaults[s.key] = s.default;
    setSlotValues((prev) => ({ ...defaults, ...prev }));
  }
  const setSlot = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setSlotValues((v) => ({ ...v, [key]: e.target.value }));

  const set = (key: keyof Branding) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setBranding((b) => ({ ...b, [key]: e.target.value }));

  const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) { setLogoDataUrl(null); return; }
    if (f.size > 8 * 1024 * 1024) {
      toast({ title: "Logo zu groß", description: "Max. 8 MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  };

  const onFavicon = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) { setFaviconDataUrl(null); return; }
    if (f.size > 200 * 1024) {
      toast({ title: "Favicon zu groß", description: "Max. 200 KB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFaviconDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  };

  // Live-Preview: Theme-HTML/CSS clientseitig mit Platzhaltern füllen und
  // als single-doc <iframe srcdoc> rendern (Logo als data-URL inline).
  const previewSrcDoc = (() => {
    const theme = THEMES.find((t) => t.id === themeId);
    if (!theme) return "";
    const replace = (src: string) => {
      let out = src;
      // Auto-Defaults für SEO, damit Preview den Tab-Titel anzeigt
      const seoTitle = branding.seo_title || (branding.firmenname ? `${branding.firmenname} — Karriere & Beratung` : "Landing-Page");
      const seoDesc = branding.seo_description || (branding.firmenname ? `${branding.firmenname} — Jetzt bewerben.` : "");
      const previewBranding = { ...branding, seo_title: seoTitle, seo_description: seoDesc };
      for (const [k, v] of Object.entries(previewBranding)) {
        out = out.split(`{{${k}}}`).join(String(v ?? ""));
      }
      for (const [k, v] of Object.entries(slotValues)) {
        out = out.split(`{{${k}}}`).join(String(v ?? ""));
      }
      return out;
    };
    let html = replace(theme.html);
    const css = replace(theme.css);
    // Leere/kaputte Meta-Tags auch im Preview entfernen
    if (!branding.seo_image) {
      html = html.replace(/\s*<meta[^>]*property=["']og:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
    }
    if (!branding.landing_domain) {
      html = html.replace(/\s*<link[^>]*rel=["']canonical["'][^>]*href=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
      html = html.replace(/\s*<meta[^>]*property=["']og:url["'][^>]*content=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
    }
    // <link rel="stylesheet" href="style.css"> durch inline <style> ersetzen
    // + Override für Scroll-Animationen (data-animate ist im Theme initial opacity:0,
    //   wird normal per IntersectionObserver in script.js eingeblendet – im Preview
    //   ohne JS bleibt sonst alles unsichtbar).
    html = html.replace(
      /<link[^>]+href=["']style\.css["'][^>]*>/i,
      `<style>${css}\n[data-animate]{opacity:1!important;transform:none!important}</style>`,
    );
    // Logo durch data-URL ersetzen, sonst Platzhalter-Pixel
    const logoSrc = logoDataUrl ?? "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='40'><rect width='100%' height='100%' fill='%23e2e8f0'/><text x='50%' y='55%' text-anchor='middle' font-family='sans-serif' font-size='12' fill='%2364748b'>Logo</text></svg>";
    html = html.replace(/assets\/logo\.[a-z]+/gi, logoSrc);
    // script.js entfernen (Preview ohne Submit) + Mini-Smooth-Scroll injizieren,
    // damit Hash-Links (#angebot etc.) im srcdoc-iframe nicht das Doc neuladen
    // → andernfalls bleibt der iframe in "Laden..." hängen.
    html = html.replace(/<script[^>]*src=["']script\.js["'][^>]*><\/script>/i, "");
    const previewScript = `<script>
var LEGAL_IDS = ["impressum","datenschutz","agb"];
function syncLegal(){
  var h = (location.hash||"").replace("#","");
  document.querySelectorAll(".legal").forEach(function(el){ el.classList.remove("is-open"); });
  if (LEGAL_IDS.indexOf(h) >= 0){
    var el = document.getElementById(h);
    if (el){ el.classList.add("is-open"); el.scrollIntoView({behavior:"smooth",block:"start"}); }
  }
}
window.addEventListener("hashchange", syncLegal);
setTimeout(syncLegal, 50);
document.addEventListener('click', function(e){
  var burger = e.target.closest && e.target.closest('#burger, .burger, [aria-label="Menü"], [aria-label="Menu"]');
  if(burger){
    e.preventDefault();
    var nav = document.getElementById('nav-links') || document.querySelector('.nav-links, nav');
    if(nav) nav.classList.toggle('open');
    return;
  }
  var a = e.target.closest && e.target.closest('a[href^="#"]');
  if(a){
    var id = a.getAttribute('href');
    if(id && id.length > 1){
      var target = id.slice(1);
      // Legal-Links: nativen Hash-Wechsel zulassen → :target + hashchange greifen
      if (LEGAL_IDS.indexOf(target) >= 0){
        e.preventDefault();
        if (location.hash === id){ syncLegal(); } else { location.hash = id; }
        return;
      }
      e.preventDefault();
      document.querySelectorAll('.legal').forEach(function(s){ s.classList.remove('is-open'); });
      if (location.hash){ try { history.replaceState(null, '', location.pathname + location.search); } catch(_){} }
      var el = document.querySelector(id);
      if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
    }
    return;
  }
  var b = e.target.closest && e.target.closest('.faq-q');
  if(b){ var item = b.closest('.faq-item'); if(item) item.classList.toggle('open'); }
}, true);
var __FLOW = ${JSON.stringify(branding.flow_type || "classic")};
var __WA = ${JSON.stringify((branding.whatsapp_number || "").replace(/[^0-9]/g, ""))};
document.addEventListener('submit', function(e){
  var f = e.target && e.target.id === 'application-form' ? e.target : null;
  if(!f) return;
  e.preventDefault();
  var status = document.getElementById('form-status');
  if(status){ status.className = 'status success'; status.textContent = 'Bewerbung erfolgreich gesendet. [Vorschau-Modus]'; }
  try { f.reset(); } catch(_){}
  if(typeof showApplicationModal === 'function'){
    showApplicationModal({ fast: __FLOW === 'fast', whatsapp: __WA });
  }
}, true);
<\/script>`;
    html = html.replace(/<\/body>/i, previewScript + "</body>");

    return html;
  })();

  const withSeoDefaults = (b: Branding): Branding => ({
    ...b,
    seo_title: b.seo_title || (b.firmenname ? `${b.firmenname} — Karriere & Beratung` : ""),
    seo_description:
      b.seo_description ||
      (b.firmenname
        ? `${b.firmenname} — Jetzt bewerben und Teil unseres Teams werden. Strategische Beratung mit messbaren Ergebnissen.`
        : ""),
  });

  const handleGenerate = async () => {
    if (!branding.firmenname || !branding.email || !branding.api_endpoint) {
      toast({ title: "Fehlende Felder", description: "Firmenname, E-Mail und API-Endpoint sind Pflicht.", variant: "destructive" });
      return;
    }
    if (!branding.landing_domain.trim()) {
      toast({ title: "Landing-Domain fehlt", description: "Trage die öffentliche Domain ein (z.B. easy-gmbh.de) — wird für Canonical/SEO benötigt.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await generate({ data: { themeId, branding: withSeoDefaults(branding), logoDataUrl, faviconDataUrl, slots: slotValues } });
      // Base64 → Blob → Download
      const bin = atob(res.zipBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLastFile(res.filename);
      toast({ title: "ZIP heruntergeladen", description: res.filename });
    } catch (err: any) {
      toast({ title: "Fehler", description: err?.message ?? "Generierung fehlgeschlagen", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const apiPlaceholder = "https://api.mb-portal.com/api/public/applications";

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
            <Globe className="h-5 w-5" /> Landing-Page-Generator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Theme auswählen, Branding ausfüllen, ZIP herunterladen und per FileZilla auf deinen VPS hochladen.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPreview((s) => !s)}
          className="gap-2 lg:hidden"
        >
          <Eye className="h-4 w-4" />
          {showPreview ? "Vorschau aus" : "Vorschau ein"}
        </Button>
      </div>

      <div className="grid lg:grid-cols-[1fr_640px] gap-6 items-start">
        {/* LEFT: Form */}
        <div className="space-y-6 min-w-0">
          {/* Step 1: Theme */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">1. Theme wählen</CardTitle>
              <CardDescription>3 Vorlagen: Executive, klassische Beratung, Datenschutz.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2">
                {THEME_LIST.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setThemeId(t.id)}
                    className={cn(
                      "text-left rounded-lg border-2 p-3 transition-all",
                      themeId === t.id
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold text-sm truncate">{t.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground/70 font-mono">{t.id}</span>
                        {themeId === t.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                  </button>
                ))}
              </div>

            </CardContent>
          </Card>

          {/* Step 2: Branding */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">2. Branding & Inhalte</CardTitle>
              <CardDescription>Änderungen erscheinen sofort in der Live-Vorschau rechts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Firmenname *"><Input value={branding.firmenname} onChange={set("firmenname")} placeholder="Mustermann GmbH" /></Field>
                <Field label="Logo (PNG/JPG/SVG, max 8 MB)">
                  <div className="space-y-2">
                    <Input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogo} />
                    {logoDataUrl && (
                      <div className="rounded border bg-muted/30 p-2 flex items-center justify-center h-16">
                        <img src={logoDataUrl} alt="Logo Preview" className="max-h-12 object-contain" />
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">Empfohlen: ≥200×60 px, transparenter Hintergrund.</p>
                  </div>
                </Field>
                <Field label="Favicon (ICO/PNG/SVG, max 200 KB)">
                  <div className="space-y-2">
                    <Input type="file" accept="image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml" onChange={onFavicon} />
                    {faviconDataUrl && (
                      <div className="rounded border bg-muted/30 p-2 flex items-center justify-center h-12">
                        <img src={faviconDataUrl} alt="Favicon Preview" className="max-h-8 object-contain" />
                      </div>
                    )}
                  </div>
                </Field>
                <Field label="Primärfarbe">
                  <div className="flex gap-2">
                    <Input type="color" value={branding.primary_color} onChange={set("primary_color")} className="w-16 p-1 h-10" />
                    <Input value={branding.primary_color} onChange={set("primary_color")} />
                  </div>
                </Field>
                <Field label="Sekundärfarbe">
                  <div className="flex gap-2">
                    <Input type="color" value={branding.secondary_color} onChange={set("secondary_color")} className="w-16 p-1 h-10" />
                    <Input value={branding.secondary_color} onChange={set("secondary_color")} />
                  </div>
                </Field>
                <Field label="WhatsApp-Nummer (international, ohne +)"><Input value={branding.whatsapp_number} onChange={set("whatsapp_number")} placeholder="491234567890" /></Field>
                <Field label="Kontakt-E-Mail *"><Input type="email" value={branding.email} onChange={set("email")} /></Field>
                <Field label="Telefon"><Input value={branding.telefon} onChange={set("telefon")} /></Field>
                <Field label="Straße & Hausnummer"><Input value={branding.strasse} onChange={set("strasse")} /></Field>
                <Field label="PLZ"><Input value={branding.plz} onChange={set("plz")} maxLength={20} /></Field>
                <Field label="Stadt"><Input value={branding.stadt} onChange={set("stadt")} /></Field>
                <Field label="HRB-Nummer"><Input value={branding.hrb} onChange={set("hrb")} /></Field>
                <Field label="Registergericht"><Input value={branding.registergericht} onChange={set("registergericht")} placeholder="Amtsgericht Berlin" /></Field>
                <Field label="USt-IdNr."><Input value={branding.ust_id} onChange={set("ust_id")} placeholder="DE123456789" /></Field>
                <Field label="Steuernummer"><Input value={branding.steuernummer} onChange={set("steuernummer")} /></Field>
                <Field label="Geschäftsführer"><Input value={branding.geschaeftsfuehrer} onChange={set("geschaeftsfuehrer")} /></Field>
                <Field label="Telefon 2 (optional)"><Input value={branding.telefon_2} onChange={set("telefon_2")} /></Field>
                <Field label="Landing-Domain * (für SEO/Canonical & OG-URL)"><Input value={branding.landing_domain} onChange={set("landing_domain")} placeholder="easy-gmbh.de" /></Field>
                <Field label="API-Endpoint für Bewerbungen *">
                  <Input value={branding.api_endpoint} onChange={set("api_endpoint")} placeholder={apiPlaceholder} />
                  <p className="text-[10px] text-muted-foreground mt-1">Zentrales Backend für alle Kunden: <code>https://api.mb-portal.com/api/public/applications</code></p>
                </Field>
                <Field label="Mitarbeiter-Portal URL (Redirect nach Bewerbung)">
                  <Input value={branding.portal_url} onChange={set("portal_url")} placeholder="https://portal.easy-gmbh.de" />
                </Field>
                <Field label="Supabase URL (Backend, falls direkter Insert)">
                  <Input value={branding.supabase_url} onChange={set("supabase_url")} placeholder="https://db.deine-domain.de" />
                </Field>
                <Field label="Supabase Anon Key">
                  <Input value={branding.supabase_anon_key} onChange={set("supabase_anon_key")} placeholder="eyJhbGciOi..." />
                </Field>
                <Field label="Tenant-ID (für Multi-Tenant-Filter)">
                  <Input value={branding.tenant_id} onChange={set("tenant_id")} placeholder="uuid" />
                </Field>
              </div>
              <Field label="Impressum-Text">
                <Textarea rows={4} value={branding.impressum} onChange={set("impressum")} />
              </Field>

              {/* Flow-Typ */}
              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <Label className="text-xs font-semibold">Bewerbungs-Flow</Label>
                <div className="grid sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBranding((b) => ({ ...b, flow_type: "classic" }))}
                    className={cn(
                      "text-left rounded-md border-2 p-3 transition-all text-xs",
                      branding.flow_type === "classic"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="font-semibold mb-1">🟡 Klassisch</div>
                    <p className="text-muted-foreground text-[11px]">
                      Bewerbung landet als <code>neu</code> im Admin. Du akzeptierst manuell → System verschickt Einladungs-Mail.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBranding((b) => ({ ...b, flow_type: "fast" }))}
                    className={cn(
                      "text-left rounded-md border-2 p-3 transition-all text-xs",
                      branding.flow_type === "fast"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="font-semibold mb-1">⚡ Fast-Track (WhatsApp)</div>
                    <p className="text-muted-foreground text-[11px]">
                      Nach dem Absenden öffnet sich ein Pop-up mit <strong>WhatsApp-Direkt-Kontakt</strong> (Nummer aus „WhatsApp-Nummer"). Bewerbung wird sofort <code>akzeptiert</code>.
                    </p>
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 2c: SEO / Browser-Tab */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">2c. SEO & Browser-Tab</CardTitle>
              <CardDescription>
                Browser-Tab-Titel, Google-Beschreibung und Social-Sharing-Vorschau (WhatsApp, LinkedIn, Facebook). Leer lassen = Auto-Werte aus Firmenname.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Seitentitel (Browser-Tab, max. 60 Zeichen)">
                <Input
                  value={branding.seo_title}
                  onChange={set("seo_title")}
                  placeholder={branding.firmenname ? `${branding.firmenname} — Beratung & Karriere` : "z.B. Mustermann GmbH — Beratung"}
                  maxLength={160}
                />
                <p className="text-[10px] text-muted-foreground mt-1">{branding.seo_title.length}/60 empfohlen · erscheint im Browser-Tab und bei Google</p>
              </Field>
              <Field label="Meta-Beschreibung (Google-Suchergebnis, max. 160 Zeichen)">
                <Textarea
                  rows={2}
                  value={branding.seo_description}
                  onChange={set("seo_description")}
                  placeholder="1–2 Sätze, die Besucher zum Klicken bewegen. Wird in Google angezeigt."
                  maxLength={320}
                />
                <p className="text-[10px] text-muted-foreground mt-1">{branding.seo_description.length}/160 empfohlen</p>
              </Field>
              <Field label="OG-Bild URL (optional, Vorschaubild für WhatsApp/LinkedIn/Facebook)">
                <Input
                  value={branding.seo_image}
                  onChange={set("seo_image")}
                  placeholder="https://kunde-x.de/og-image.jpg (1200×630 px)"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Leer = kein Vorschaubild. Empfohlen 1200×630 px.</p>
              </Field>
            </CardContent>
          </Card>

          {/* Step 2b: Theme-spezifische Inhalte (Slots) */}
          {currentSlots.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">2b. Theme-Inhalte ({currentTheme?.name})</CardTitle>
                <CardDescription>Texte, Bilder und Farben dieses Themes individuell anpassen.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {currentSlots.map((slot) => (
                  <Field key={slot.key} label={slot.label}>
                    {slot.type === "longtext" ? (
                      <Textarea rows={3} value={slotValues[slot.key] ?? slot.default} onChange={setSlot(slot.key)} className="font-mono text-xs" />
                    ) : slot.type === "color" ? (
                      <div className="flex gap-2">
                        <Input type="color" value={slotValues[slot.key] ?? slot.default} onChange={setSlot(slot.key)} className="w-16 p-1 h-10" />
                        <Input value={slotValues[slot.key] ?? slot.default} onChange={setSlot(slot.key)} />
                      </div>
                    ) : slot.type === "image" ? (
                      <Input value={slotValues[slot.key] ?? slot.default} onChange={setSlot(slot.key)} placeholder="https://… oder /assets/foo.jpg" />
                    ) : (
                      <Input value={slotValues[slot.key] ?? slot.default} onChange={setSlot(slot.key)} />
                    )}
                  </Field>
                ))}
              </CardContent>
            </Card>
          )}


          {/* Step 3: Build */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">3. ZIP generieren</CardTitle>
              <CardDescription>Lade die ZIP herunter und entpacke sie auf deinem VPS.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button onClick={handleGenerate} disabled={loading} className="gap-2 w-full sm:w-auto">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {loading ? "Generiere…" : "Landing-Page als ZIP herunterladen"}
              </Button>
              {lastFile && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  Letzter Download: <span className="font-mono">{lastFile}</span>
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Sticky Live-Preview (desktop) / collapsible (mobile) */}
        <div className={cn("lg:block", showPreview ? "block" : "hidden")}>
          <div className="lg:sticky lg:top-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Eye className="h-3.5 w-3.5" /> Live-Vorschau
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={() => {
                  const blob = new Blob([previewSrcDoc], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank", "noopener,noreferrer");
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" /> In neuem Tab öffnen
              </Button>
            </div>
            <div className="rounded-lg border-2 border-border overflow-hidden bg-background shadow-sm">
              <div className="flex items-center gap-1.5 bg-muted/50 px-3 py-2 border-b">
                <div className="flex gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 text-center text-[10px] text-muted-foreground font-mono truncate">
                  {branding.landing_domain || "preview.localhost"}
                </div>
              </div>
              <iframe
                title="Landing Preview"
                srcDoc={previewSrcDoc}
                sandbox="allow-same-origin allow-scripts"
                className="w-full h-[calc(100vh-180px)] min-h-[600px] border-0 bg-white"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}