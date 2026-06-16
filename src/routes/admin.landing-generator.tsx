import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { generateLandingZip } from "@/lib/landing-generator.functions";
import { getLandingFunnel } from "@/lib/landing-funnel.functions";
import { THEME_LIST, THEMES } from "@/lib/landing-themes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Download, Globe, Loader2, CheckCircle2, Eye, ExternalLink, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/landing-generator")({
  component: LandingGeneratorPage,
});

type Branding = {
  firmenname: string;
  primary_color: string;
  secondary_color: string;
  whatsapp_number: string;
  whatsapp_enabled: boolean;
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
  source_slug: string;
  seo_title: string;
  seo_description: string;
  seo_image: string;
};

const EMPTY: Branding = {
  firmenname: "",
  primary_color: "#2563eb",
  secondary_color: "#1e40af",
  whatsapp_number: "",
  whatsapp_enabled: false,
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
  source_slug: "",
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
var __WA = ${JSON.stringify(branding.whatsapp_enabled ? (branding.whatsapp_number || "").replace(/[^0-9]/g, "") : "")};
var __API = ${JSON.stringify(branding.api_endpoint || "")};
var __TENANT = ${JSON.stringify(branding.tenant_id || "")};
var __PORTAL = ${JSON.stringify(branding.portal_url || "")};
var __SLUG = ${JSON.stringify(branding.source_slug || branding.landing_domain || branding.firmenname || "preview")};
function __waFormatNumber(num){ var d=String(num||'').replace(/[^0-9]/g,''); if(!d) return ''; if(d.length>4) return '+'+d.slice(0,2)+' '+d.slice(2,5)+' '+d.slice(5); return '+'+d; }
function showApplicationModal(opts){
  opts = opts || {}; var isFast = !!opts.fast; var wa = String(opts.whatsapp||'').replace(/[^0-9]/g,'');
  var overlay = document.createElement('div');
  overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;backdrop-filter:blur(2px);';
  var box = document.createElement('div');
  box.style.cssText='background:#fff;color:#0f172a;max-width:460px;width:100%;border-radius:14px;padding:28px;box-shadow:0 20px 60px -10px rgba(0,0,0,.35);font-family:inherit;position:relative;';
  var close = document.createElement('button'); close.type='button'; close.innerHTML='&times;';
  close.style.cssText='position:absolute;top:10px;right:14px;background:none;border:0;font-size:24px;line-height:1;cursor:pointer;color:#64748b;';
  close.onclick=function(){ overlay.remove(); };
  var check = document.createElement('div');
  check.style.cssText='width:46px;height:46px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;margin-bottom:14px;';
  check.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var h = document.createElement('h3'); h.textContent='Vielen Dank für Ihre Bewerbung';
  h.style.cssText='margin:0 0 8px;font-size:22px;font-weight:700;line-height:1.25;';
  var p = document.createElement('p'); p.style.cssText='margin:0 0 18px;color:#475569;font-size:15px;line-height:1.55;';
  box.appendChild(close); box.appendChild(check); box.appendChild(h); box.appendChild(p);
  if(isFast){
    p.textContent='Vielen Dank für Ihre Bewerbung. Im nächsten Schritt werden Sie zum Mitarbeiter-Portal für die Registrierung weitergeleitet.';
    var goNowPrev = document.createElement('button');
    goNowPrev.type='button'; goNowPrev.textContent='Jetzt zum Portal →';
    goNowPrev.style.cssText='display:block;width:100%;background:#0f172a;color:#fff;border:0;padding:12px 18px;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;margin-bottom:12px;';
    var hasRealRedir = opts.redirectUrl && /^https?:\\/\\//i.test(opts.redirectUrl);
    if(hasRealRedir){ goNowPrev.onclick = function(){ window.top ? window.top.location.href = opts.redirectUrl : window.location.href = opts.redirectUrl; }; }
    else { goNowPrev.onclick = function(){ alert('[Vorschau] Weiterleitung deaktiviert — kein Portal-URL gesetzt.'); }; }
    var redirInfo = document.createElement('p');
    redirInfo.style.cssText='margin:0 0 12px;font-size:13px;color:#64748b;';
    redirInfo.textContent = hasRealRedir ? 'Klick "Jetzt zum Portal", um Weiterleitung in neuem Tab zu testen.' : '[Vorschau] Keine echte Weiterleitung (kein Portal-URL gesetzt).';
    box.appendChild(goNowPrev); box.appendChild(redirInfo);
  } else if(wa){
    p.textContent='Vielen Dank für Ihre Bewerbung. Wir haben Ihre Bewerbung erhalten und melden uns binnen 10 Tagen zurück.';
    var card = document.createElement('div');
    card.style.cssText='background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px;';
    var label = document.createElement('div'); label.textContent='SCHNELLER KONTAKT';
    label.style.cssText='font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb;margin-bottom:8px;';
    var info = document.createElement('p'); info.style.cssText='margin:0 0 12px;font-size:14px;color:#475569;line-height:1.5;';
    info.innerHTML='Melden Sie sich bei WhatsApp unter <strong>'+__waFormatNumber(wa)+'</strong>, um auf dem neusten Stand zu bleiben.';
    var btn = document.createElement('a');
    btn.href='https://wa.me/'+wa+'?text='+encodeURIComponent('Hallo, ich habe gerade meine Bewerbung abgeschickt.');
    btn.target='_blank'; btn.rel='noopener';
    btn.style.cssText='display:flex;align-items:center;justify-content:center;gap:8px;background:#22c55e;color:#fff;text-decoration:none;font-weight:600;padding:12px 16px;border-radius:8px;font-size:15px;';
    btn.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24z"/></svg> WhatsApp-Chat starten';
    card.appendChild(label); card.appendChild(info); card.appendChild(btn);
    box.appendChild(card);
  } else {
    p.textContent='Wir haben Ihre Unterlagen erhalten und melden uns i.d.R. innerhalb von 10 Tagen per E-Mail bei Ihnen.';
  }
  var closeBtn = document.createElement('button'); closeBtn.type='button'; closeBtn.textContent='Schließen';
  closeBtn.style.cssText='background:#fff;border:1px solid #cbd5e1;color:#0f172a;padding:9px 18px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;';
  closeBtn.onclick=function(){ overlay.remove(); };
  box.appendChild(closeBtn); overlay.appendChild(box);
  overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
document.addEventListener('submit', function(e){
  var f = e.target && e.target.id === 'application-form' ? e.target : null;
  if(!f) return;
  e.preventDefault();
  var status = document.getElementById('form-status');
  var raw = Object.fromEntries(new FormData(f).entries());
  var first = (raw.first_name||'').toString().trim();
  var last = (raw.last_name||'').toString().trim();
  var street = (raw.street||'').toString().trim();
  var msg = (raw.message||'').toString().trim();
  var payload = {
    full_name: ((first + ' ' + last).trim()) || (raw.full_name||'').toString() || 'Vorschau-Test',
    email: (raw.email||'').toString().trim() || 'preview-test@example.com',
    phone: raw.phone || null,
    postal_code: raw.postal_code || null,
    city: raw.city || null,
    message: [street ? 'Adresse: ' + street : '', msg].filter(Boolean).join('\\n\\n') || null,
    tenant_id: __TENANT || null,
    portal_url: __PORTAL || null,
    flow_type: __FLOW,
    source_slug: __SLUG,
    is_test: true,
  };
  if(!__API){
    if(status){ status.className='status error'; status.textContent='⚠️ Kein API-Endpoint konfiguriert (Feld "API-Endpoint" leer).'; }
    return;
  }
  if(status){ status.className='status'; status.textContent='Test-Bewerbung wird gesendet …'; }
  fetch(__API, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(function(res){
      try { f.reset(); } catch(_){}
      if(status){ status.className='status success'; status.textContent='✅ Test-Bewerbung gespeichert (mit [TEST]-Markierung).'; }
      var redir = (res && res.redirect_url) ? res.redirect_url : '';
      showApplicationModal({ fast: __FLOW === 'fast', whatsapp: __WA, redirectUrl: redir });
    })
    .catch(function(err){
      if(status){ status.className='status error'; status.textContent='❌ Fehler: '+(err && err.message ? err.message : 'Senden fehlgeschlagen'); }
    });
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
    if (branding.flow_type === "fast" && !branding.portal_url.trim()) {
      toast({ title: "Portal-URL fehlt", description: "Fast-Track braucht eine Portal-URL für die Weiterleitung. Trage z.B. https://portal.deine-firma.de ein.", variant: "destructive" });
      return;
    }
    if (!branding.tenant_id.trim()) {
      toast({ title: "Tenant-ID fehlt", description: "Ohne Tenant-ID landet die Bewerbung beim falschen Mandanten. Hol sie aus Admin → Tenants.", variant: "destructive" });
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

  const apiPlaceholder = "https://portal.mb-portal.com/api/public/applications";

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

      <FunnelPanel />

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
              {/* Setup-Vorlage / Pflichtfeld-Hilfe */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs space-y-2">
                <div className="font-semibold text-primary">📋 Setup-Vorlage — was MUSS rein, damit es funktioniert</div>
                <ul className="space-y-1.5 text-muted-foreground">
                  <li><strong className="text-foreground">Firmenname *</strong> — z.B. <code>UWK Consulting GmbH</code></li>
                  <li><strong className="text-foreground">Kontakt-E-Mail *</strong> — Reply-Adresse, z.B. <code>info@uwk-consulting.de</code></li>
                  <li><strong className="text-foreground">Landing-Domain *</strong> — Domain der Landing (ohne <code>https://</code>), z.B. <code>uwk-consulting.de</code></li>
                  <li>
                    <strong className="text-foreground">API-Endpoint *</strong> — IMMER dein zentrales Portal-Backend:<br/>
                    <code>https://portal.mb-portal.com/api/public/applications</code> (für alle Kunden gleich)
                  </li>
                  <li>
                    <strong className="text-foreground">Tenant-ID *</strong> — UUID aus Admin → Tenants → Spalte „ID" kopieren.<br/>
                    Ohne Tenant-ID kommen Bewerbungen NICHT beim richtigen Kunden an (Reminder/Accept-Mail nutzen falschen SMTP).
                  </li>
                  <li>
                    <strong className="text-foreground">Mitarbeiter-Portal URL *</strong> (bei Fast-Track Pflicht) — Portal des Tenants,<br/>
                    z.B. <code>https://portal.uwk-consulting.de</code>. Nach Bewerbung Auto-Redirect zur Registrierung.
                  </li>
                  <li><strong className="text-foreground">WhatsApp-Nummer</strong> (optional) — international ohne <code>+</code>, z.B. <code>491701234567</code>. Aktiviert Floating-Button + Kontakt-Card.</li>
                  <li><strong className="text-foreground">Logo / Favicon / Farben</strong> — empfohlen, aber nicht Pflicht.</li>
                </ul>
                <div className="pt-1 text-[11px] text-muted-foreground">
                  Felder unten ohne <span className="text-primary">*</span> sind optional (Impressum-Daten, SEO-Bild, Telefon-2, etc.).
                </div>
              </div>

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
                <Field label="WhatsApp im Erfolgs-Popup & als Floating-Button anzeigen">
                  <label className="flex items-center gap-2 h-10 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={branding.whatsapp_enabled}
                      onChange={(e) => setBranding((b) => ({ ...b, whatsapp_enabled: e.target.checked }))}
                      className="h-4 w-4"
                    />
                    <span className="text-muted-foreground">
                      Aktiviert „Jetzt bei WhatsApp kontaktieren" nach erfolgreicher Bewerbung (Link auf wa.me/{branding.whatsapp_number || "…"}).
                    </span>
                  </label>
                </Field>
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
                <Field label="Tracking-Slug (Funnel-Statistik)">
                  <Input
                    value={branding.source_slug}
                    onChange={set("source_slug")}
                    placeholder={branding.landing_domain || "z.B. kw24-fast-de"}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Wird mit jeder Bewerbung gespeichert (<code>source_slug</code>). So siehst du im Funnel-Panel: <em>1000 Bewerbungen → 650 registriert → 210 abgeschlossen</em>. Leer = Domain wird automatisch genutzt.
                  </p>
                </Field>
                <Field label="API-Endpoint für Bewerbungen *">
                  <Input value={branding.api_endpoint} onChange={set("api_endpoint")} placeholder={apiPlaceholder} />
                  <p className="text-[10px] text-muted-foreground mt-1">Immer das zentrale Portal-Backend: <code>https://portal.mb-portal.com/api/public/applications</code></p>
                </Field>
                <Field label="Mitarbeiter-Portal URL * (Redirect nach Fast-Track-Bewerbung)">
                  <Input value={branding.portal_url} onChange={set("portal_url")} placeholder="https://portal.uwk-consulting.de" />
                  <p className="text-[10px] text-muted-foreground mt-1">Tenant-eigenes Portal. Bei Fast-Track wird der Bewerber hierhin zu <code>/register</code> weitergeleitet.</p>
                </Field>
                <Field label="Supabase URL (optional — nur bei Direkt-Insert)">
                  <Input value={branding.supabase_url} onChange={set("supabase_url")} placeholder="leer lassen" />
                </Field>
                <Field label="Supabase Anon Key (optional)">
                  <Input value={branding.supabase_anon_key} onChange={set("supabase_anon_key")} placeholder="leer lassen" />
                </Field>
                <Field label="Tenant-ID * (UUID aus Admin → Tenants)">
                  <Input value={branding.tenant_id} onChange={set("tenant_id")} placeholder="z.B. 6b9c1f2a-4d3e-…" />
                  <p className="text-[10px] text-muted-foreground mt-1">Pflicht! Ohne Tenant-ID landet die Bewerbung beim falschen Mandanten.</p>
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
                    <div className="font-semibold mb-1">⚡ Fast-Track</div>
                    <p className="text-muted-foreground text-[11px]">
                      Bewerbung wird sofort <code>akzeptiert</code>. Pop-up: „Vielen Dank, Sie werden zum Mitarbeiter-Portal weitergeleitet" + Auto-Redirect nach 3 Sek. zu <code>portal_url/register</code>. <strong>Portal-URL ist Pflicht.</strong>
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

type FunnelRow = { key: string; label: string; bewerbungen: number; registriert: number; abgeschlossen: number; conv_reg: number; conv_done: number };

function FunnelPanel() {
  const fn = useServerFn(getLandingFunnel);
  const [scope, setScope] = useState<"per_slug" | "global_flow">("per_slug");
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    fn({ data: { scope, days } as any })
      .then((r: any) => { setRows(r.rows ?? []); if (r.error) setErr(r.error); })
      .catch((e: any) => setErr(e?.message ?? "Fehler"))
      .finally(() => setLoading(false));
  }, [scope, days]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Funnel: Bewerbung → Registrierung → Onboarding
        </CardTitle>
        <CardDescription>
          Test-Bewerbungen sind ausgeschlossen. „Registriert" = E-Mail-Match mit Profil, „Abgeschlossen" = Onboarding-Status = abgeschlossen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button size="sm" variant={scope === "per_slug" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setScope("per_slug")}>Pro Landing-Page</Button>
          <Button size="sm" variant={scope === "global_flow" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setScope("global_flow")}>Global: Fast vs. Klassisch</Button>
          <span className="ml-auto text-muted-foreground">Zeitraum:</span>
          {[30, 90, 180, 365].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} className="h-8 px-2 text-xs" onClick={() => setDays(d)}>{d}d</Button>
          ))}
        </div>
        {loading ? (
          <p className="text-xs text-muted-foreground">Lade …</p>
        ) : err ? (
          <p className="text-xs text-destructive">Fehler: {err}</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Noch keine Bewerbungen im Zeitraum (oder kein <code>source_slug</code> gesetzt).</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-1.5 px-2 font-medium">{scope === "global_flow" ? "Flow" : "Landing / Slug"}</th>
                  <th className="text-right py-1.5 px-2 font-medium">Bewerbungen</th>
                  <th className="text-right py-1.5 px-2 font-medium">Registriert</th>
                  <th className="text-right py-1.5 px-2 font-medium">Abgeschlossen</th>
                  <th className="text-right py-1.5 px-2 font-medium">Reg-%</th>
                  <th className="text-right py-1.5 px-2 font-medium">Done-%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-1.5 px-2 font-mono truncate max-w-[280px]" title={r.label}>{r.label}</td>
                    <td className="text-right py-1.5 px-2 font-semibold">{r.bewerbungen}</td>
                    <td className="text-right py-1.5 px-2">{r.registriert}</td>
                    <td className="text-right py-1.5 px-2">{r.abgeschlossen}</td>
                    <td className="text-right py-1.5 px-2 text-emerald-700 dark:text-emerald-300">{r.conv_reg}%</td>
                    <td className="text-right py-1.5 px-2 text-primary">{r.conv_done}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}