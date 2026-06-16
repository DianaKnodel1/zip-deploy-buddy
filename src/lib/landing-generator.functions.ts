import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import JSZip from "jszip";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getTheme } from "./landing-themes";

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Ungültige Hex-Farbe");

// Akzeptiert "example.com", "www.example.com" oder volle URLs.
// Wird vor der URL-Validierung normalisiert (https:// prepended, trailing slash entfernt).
const normalizeUrl = (v: unknown) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (!trimmed) return trimmed;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
};
const UrlLike = z.preprocess(normalizeUrl, z.string().url().max(500));
const OptionalUrlLike = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? "" : normalizeUrl(v)),
  z.union([z.string().url().max(500), z.literal("")]),
);

const BrandingSchema = z.object({
  firmenname: z.string().min(1).max(120),
  primary_color: HexColor,
  secondary_color: HexColor,
  whatsapp_number: z.string().max(40).default(""),
  whatsapp_enabled: z.coerce.boolean().default(false),
  email: z.string().email().max(255),
  telefon: z.string().max(40).default(""),
  telefon_2: z.string().max(40).default(""),
  strasse: z.string().max(200).default(""),
  plz: z.string().max(20).default(""),
  stadt: z.string().max(120).default(""),
  hrb: z.string().max(60).default(""),
  registergericht: z.string().max(120).default(""),
  ust_id: z.string().max(40).default(""),
  steuernummer: z.string().max(40).default(""),
  geschaeftsfuehrer: z.string().max(120).default(""),
  impressum: z.string().max(5000).default(""),
  landing_domain: z.string().min(1, "Landing-Domain ist Pflicht (für SEO/Canonical)").max(255),
  api_endpoint: UrlLike,
  portal_url: OptionalUrlLike.default(""),
  supabase_url: OptionalUrlLike.default(""),
  supabase_anon_key: z.string().max(2000).optional().or(z.literal("")).default(""),
  tenant_id: z.string().max(120).optional().or(z.literal("")).default(""),

  flow_type: z.enum(["classic", "fast"]).default("classic"),
  // Funnel-Tracking: kurzer Slug pro Landing (z.B. "kw24-fast-de").
  // Wird mit jeder Bewerbung gespeichert → Konversion pro Landing messbar.
  source_slug: z.string().max(120).default(""),
  // SEO / Browser-Tab
  seo_title: z.string().max(160).default(""),
  seo_description: z.string().max(320).default(""),
  seo_image: z.string().max(500).default(""),
});

const InputSchema = z.object({
  themeId: z.string().min(1).max(40),
  branding: BrandingSchema,
  // Logo als data-URL: "data:image/png;base64,...."
  logoDataUrl: z.string().max(15_000_000).optional().nullable(),
  faviconDataUrl: z.string().max(1_000_000).optional().nullable(),
  // Theme-Slot-Werte (Texte/Bilder/Farben aus dem UI-Theme-Editor).
  slots: z.record(z.string().min(1).max(60), z.string().max(20_000)).optional().default({}),
});

function cleanLandingDomain(d: string): string {
  return String(d ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function applyPlaceholders(
  src: string,
  branding: z.infer<typeof BrandingSchema>,
  slotValues: Record<string, string> = {},
): string {
  let out = src;
  for (const [key, value] of Object.entries(branding)) {
    out = out.split(`{{${key}}}`).join(String(value ?? ""));
  }
  for (const [key, value] of Object.entries(slotValues)) {
    out = out.split(`{{${key}}}`).join(String(value ?? ""));
  }
  return out;
}

// Entfernt leere/kaputte Meta-Tags (og:image ohne Wert, Canonical/og:url ohne Domain).
function cleanEmptyMetaTags(html: string, b: z.infer<typeof BrandingSchema>): string {
  let out = html;
  if (!b.seo_image) {
    out = out.replace(/\s*<meta[^>]*property=["']og:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*name=["']twitter:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
  }
  if (!b.landing_domain) {
    out = out.replace(/\s*<link[^>]*rel=["']canonical["'][^>]*href=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*property=["']og:url["'][^>]*content=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
  }
  return out;
}

// Injiziert window.PORTAL_API/TENANT_ID/PORTAL_URL/FLOW_TYPE in jedes generierte
// HTML — unabhängig davon, ob das Theme-Template einen <script>-Block dafür hat.
// Garantiert, dass Bewerbungen die richtige tenant_id mitsenden → Reminder/Accept-
// Mail nutzen automatisch den korrekten Tenant-SMTP.
function injectLandingConfig(html: string, b: z.infer<typeof BrandingSchema>): string {
  const escape = (s: string) => String(s ?? "").replace(/[<>"']/g, (c) => ({ "<": "\\u003c", ">": "\\u003e", '"': '\\"', "'": "\\'" }[c]!));
  const block = `<script>
window.PORTAL_API = "${escape(b.api_endpoint)}";
window.PORTAL_URL = "${escape(b.portal_url ?? "")}";
window.TENANT_ID = "${escape(b.tenant_id ?? "")}";
window.FLOW_TYPE = "${escape(b.flow_type)}";
window.SOURCE_SLUG = "${escape(b.source_slug ?? "")}";
window.WHATSAPP_NUMBER = "${escape(b.whatsapp_enabled ? (b.whatsapp_number ?? "").replace(/[^0-9]/g, "") : "")}";
</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, block + "</head>");
  return block + html;
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

export const generateLandingZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Admin-Check
    const { data: roleRow, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    const theme = getTheme(data.themeId);
    if (!theme) throw new Error(`Theme nicht gefunden: ${data.themeId}`);

    const slots = data.slots ?? {};
    // Domain user-freundlich säubern (https://, trailing slash entfernen)
    const cleanedBranding = { ...data.branding, landing_domain: cleanLandingDomain(data.branding.landing_domain) };
    let html = applyPlaceholders(theme.html, cleanedBranding, slots);
    html = cleanEmptyMetaTags(html, cleanedBranding);
    html = injectLandingConfig(html, cleanedBranding);
    const css = applyPlaceholders(theme.css, cleanedBranding, slots);
    const js = applyPlaceholders(theme.js, cleanedBranding, slots);

    const zip = new JSZip();
    zip.file("index.html", html);
    zip.file("style.css", css);
    zip.file("script.js", js);
    zip.file(
      "README.txt",
      `Landing Page: ${data.branding.firmenname}\nTheme: ${theme.name}\nGeneriert: ${new Date().toISOString()}\n\n` +
        `Upload-Anleitung:\n` +
        `1. Diesen Ordner per FTP (FileZilla) ins Web-Root deines VPS kopieren\n` +
        `   (z.B. /var/www/${data.branding.landing_domain || "kunde"}/)\n` +
        `2. nginx/Apache konfigurieren, sodass index.html ausgeliefert wird\n` +
        `3. SSL-Zertifikat (Let's Encrypt) für die Domain einrichten\n\n` +
        `Bewerbungen werden an: ${data.branding.api_endpoint} gesendet.\n`,
    );

    if (data.logoDataUrl) {
      const parsed = parseDataUrl(data.logoDataUrl);
      if (parsed) {
        const ext = parsed.mime.includes("svg")
          ? "svg"
          : parsed.mime.includes("jpeg") || parsed.mime.includes("jpg")
            ? "jpg"
            : parsed.mime.includes("webp")
              ? "webp"
              : "png";
        // Theme erwartet assets/logo.png — wir nehmen die richtige Endung und
        // patchen das HTML, falls anders.
        const filename = `logo.${ext}`;
        zip.folder("assets")!.file(filename, parsed.bytes);
        if (ext !== "png") {
          const finalHtml = html.replace("assets/logo.png", `assets/${filename}`);
          zip.file("index.html", finalHtml);
        }
      }
    } else {
      // Platzhalter, damit der <img>-Tag nicht ins Leere zeigt
      zip.folder("assets")!.file(
        "logo.png",
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]),
      );
    }

    // Favicon (optional) — bei Fehlen 1×1-PNG-Platzhalter, damit assets/favicon.png nicht 404 wirft
    if (data.faviconDataUrl) {
      const fav = parseDataUrl(data.faviconDataUrl);
      if (fav) {
        const ext = fav.mime.includes("svg")
          ? "svg"
          : fav.mime.includes("png")
            ? "png"
            : fav.mime.includes("ico") || fav.mime.includes("icon")
              ? "ico"
              : "png";
        zip.folder("assets")!.file(`favicon.${ext}`, fav.bytes);
      }
    } else {
      zip.folder("assets")!.file(
        "favicon.png",
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]),
      );
    }

    const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    // Base64 für Transport über JSON
    let binary = "";
    for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
    const base64 = btoa(binary);

    const safeName = data.branding.firmenname.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const datum = new Date().toISOString().slice(0, 10);
    const filename = `landing-${safeName}-${theme.id}-${datum}.zip`;

    return { zipBase64: base64, filename };
  });