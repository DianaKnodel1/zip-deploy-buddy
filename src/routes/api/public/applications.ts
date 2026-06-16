import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const Schema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).optional().nullable(),
  postal_code: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
  tenant_id: z.string().uuid().optional().nullable(),
  flow_type: z.enum(["classic", "fast"]).optional().default("classic"),
  portal_url: z.string().url().max(500).optional().nullable(),
  source_slug: z.string().trim().max(120).optional().nullable(),
  is_test: z.coerce.boolean().optional().default(false),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/applications")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        const parsed = Schema.safeParse(payload);
        if (!parsed.success) {
          return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
        }
        const d = parsed.data;
        const isFast = d.flow_type === "fast";
        const displayName = d.is_test ? `[TEST] ${d.full_name}` : d.full_name;

        // Tenant-Fallback: Wenn kein tenant_id mitgeschickt wurde, versuche
        // ihn über Origin/Referer-Header zu ermitteln (Landingpage-Domain).
        let resolvedTenantId: string | null = d.tenant_id ?? null;
        if (!resolvedTenantId) {
          const originHeader = request.headers.get("origin") || request.headers.get("referer") || "";
          try {
            const host = new URL(originHeader).hostname.toLowerCase().replace(/^portal\./, "").replace(/^www\./, "");
            if (host && host !== "localhost") {
              const { data: tByPrimary } = await supabaseAdmin
                .from("tenants").select("id").eq("primary_domain", host).maybeSingle();
              if (tByPrimary?.id) {
                resolvedTenantId = tByPrimary.id;
              } else {
                const { data: tByDomain } = await supabaseAdmin
                  .from("tenants").select("id").eq("domain", host).maybeSingle();
                if (tByDomain?.id) resolvedTenantId = tByDomain.id;
              }
            }
          } catch { /* ignore parse errors */ }
        }

        const { error } = await supabaseAdmin.from("applications").insert({
          full_name: displayName,
          email: d.email,
          phone: d.phone ?? null,
          postal_code: d.postal_code ?? null,
          city: d.city ?? null,
          message: d.message ?? null,
          tenant_id: resolvedTenantId,
          status: isFast ? "akzeptiert" : "neu",
          flow_type: d.flow_type ?? "classic",
          source_slug: d.source_slug ?? null,
          is_test: !!d.is_test,
        } as any);
        if (error) {
          console.error("[applications] insert error:", error);
          return json({ error: "Could not save application" }, 500);
        }
        let redirect_url: string | null = null;
        if (isFast && d.portal_url) {
          const base = d.portal_url.replace(/\/+$/, "");
          redirect_url = `${base}/register?email=${encodeURIComponent(d.email)}&fast=1`;
        }

        // Fast-Track: Backup-Einladungsmail senden, falls der Bewerber den
        // Register-Tab schließt. Fehler nicht hart durchreichen.
        if (isFast && resolvedTenantId && redirect_url && !d.is_test) {
          // Drip-Doppelmail verhindern: bestehende queued/sending Rows für
          // diese E-Mail im Tenant als skipped markieren (Backup-Mail unten
          // übernimmt die Einladung).
          try {
            await supabaseAdmin
              .from("invite_resend_queue")
              .update({ status: "skipped", last_error: "fast_track_accept" } as any)
              .eq("tenant_id", resolvedTenantId)
              .eq("email", d.email.toLowerCase())
              .in("status", ["queued", "sending"]);
          } catch (e) {
            console.warn("[applications fast] skip drip queue:", e);
          }
          try {
            const parts = d.full_name.trim().split(/\s+/);
            const firstName = parts[0] ?? "";
            const lastName = parts.slice(1).join(" ");
            const { error: mailErr } = await supabaseAdmin.functions.invoke(
              "send-invitation-email",
              {
                body: {
                  to: d.email,
                  fullName: d.full_name,
                  firstName,
                  lastName,
                  registrationLink: redirect_url,
                  tenantId: resolvedTenantId,
                },
              },
            );
            if (mailErr) console.warn("[applications fast] invitation mail:", mailErr);
          } catch (e) {
            console.warn("[applications fast] invitation mail error:", e);
          }
        }

        return json({ success: true, flow_type: d.flow_type ?? "classic", redirect_url });

      },
    },
  },
});
