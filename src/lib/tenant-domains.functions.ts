import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

function normalizeDomain(d: string): string {
  return d.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^portal\./, "");
}

// ============================================================
// 1) Domain-Health-Check (on-demand, pingt portal.<domain>)
// ============================================================

type DomainStatus = "ok" | "down" | "slow" | "unknown";

interface DomainHealth {
  tenant_id: string;
  tenant_name: string;
  domain: string;
  is_primary: boolean;          // wird aktiv für neue Mails verwendet
  is_root: boolean;             // = tenants.domain
  status: DomainStatus;
  http_status: number | null;
  latency_ms: number | null;
  error: string | null;
}

async function pingDomain(host: string, timeoutMs = 5000): Promise<{ status: DomainStatus; http_status: number | null; latency_ms: number | null; error: string | null }> {
  const url = `https://${host}/`;
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal, redirect: "manual" });
    const latency = Date.now() - start;
    clearTimeout(t);
    // Jede HTTP-Antwort (auch 4xx/5xx/301) heißt: Domain lebt
    return {
      status: latency > 3000 ? "slow" : "ok",
      http_status: res.status,
      latency_ms: latency,
      error: null,
    };
  } catch (e: any) {
    clearTimeout(t);
    const latency = Date.now() - start;
    const msg = String(e?.message ?? e);
    return { status: "down", http_status: null, latency_ms: latency, error: msg };
  }
}

export const checkDomainsHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const sb = supabaseAdmin as any;
    const { data: tenants, error } = await sb
      .from("tenants")
      .select("id,name,domain,domain_aliases,primary_domain")
      .eq("is_active", true);
    if (error) throw new Error(error.message);

    const checks: Promise<DomainHealth>[] = [];
    for (const t of tenants ?? []) {
      const aliases: string[] = Array.isArray(t.domain_aliases) ? t.domain_aliases : [];
      const all = Array.from(new Set([t.domain, ...aliases].filter(Boolean).map((d: string) => normalizeDomain(d))));
      const primary = t.primary_domain ? normalizeDomain(t.primary_domain) : normalizeDomain(t.domain);
      for (const d of all) {
        checks.push(
          pingDomain(`portal.${d}`).then((r) => ({
            tenant_id: t.id,
            tenant_name: t.name,
            domain: d,
            is_primary: d === primary,
            is_root: d === normalizeDomain(t.domain),
            ...r,
          }))
        );
      }
    }
    const results = await Promise.all(checks);
    return { domains: results, checked_at: new Date().toISOString() };
  });

// ============================================================
// 2) Primary-Domain umschalten
// ============================================================

export const setPrimaryDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      domain: z.string().min(3).max(253),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = supabaseAdmin as any;
    const target = normalizeDomain(data.domain);

    const { data: tenant, error } = await sb
      .from("tenants")
      .select("id,domain,domain_aliases")
      .eq("id", data.tenant_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tenant) throw new Error("Tenant nicht gefunden");

    const aliases: string[] = Array.isArray(tenant.domain_aliases) ? tenant.domain_aliases : [];
    const allowed = new Set([normalizeDomain(tenant.domain), ...aliases.map(normalizeDomain)]);
    if (!allowed.has(target)) {
      throw new Error(`Domain "${target}" ist nicht beim Tenant hinterlegt. Erst als Alias auf /admin/tenants hinzufügen.`);
    }

    const { error: upErr } = await sb
      .from("tenants")
      .update({ primary_domain: target, primary_domain_changed_at: new Date().toISOString() })
      .eq("id", data.tenant_id);
    if (upErr) throw new Error(upErr.message);

    try {
      await sb.from("activity_log").insert({
        action: "primary_domain_geaendert",
        entity_type: "tenant",
        entity_id: data.tenant_id,
        actor_id: context.userId,
        comment: `Aktive Versand-Domain auf ${target} gesetzt`,
      });
    } catch {}

    return { ok: true, primary_domain: target };
  });

// ============================================================
// 3) Betroffene Empfänger einer Domain auflisten
// ============================================================

export interface AffectedRecipient {
  kind: "bewerber" | "mitarbeiter";
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  last_contact: string | null;
}

export const getAffectedRecipients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ tenant_id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = supabaseAdmin as any;

    // Bewerber: bewusst NICHT enthalten (User-Entscheidung: Bewerber sind unkritisch).
    // Mitarbeiter: ALLE anzeigen, inkl. "abgeschlossen", da auch fertig eingearbeitete
    // bei Domain-Down einen neuen Portal-Link brauchen.
    const { data: profiles, error: pErr } = await sb
      .from("profiles")
      .select("id,user_id,full_name,phone,status,onboarding_status,last_reminder_sent_at,created_at")
      .eq("tenant_id", data.tenant_id);
    if (pErr) throw new Error(pErr.message);

    const { data: usersList } = await sb.auth.admin.listUsers({ page: 1, perPage: 5000 });
    const emailByUserId = new Map<string, string>(
      (usersList?.users ?? []).map((u: any) => [u.id, (u.email ?? "").toLowerCase()])
    );

    const recipients: AffectedRecipient[] = [];
    for (const p of profiles ?? []) {
      recipients.push({
        kind: "mitarbeiter",
        id: p.user_id,
        name: p.full_name ?? "",
        email: emailByUserId.get(p.user_id) ?? null,
        phone: p.phone ?? null,
        status: p.status ?? p.onboarding_status ?? "",
        last_contact: p.last_reminder_sent_at ?? p.created_at ?? null,
      });
    }

    return { recipients, count: recipients.length };
  });

// ============================================================
// 4) Domain-Recovery Bulk-Resend (triggert Edge-Function)
// ============================================================

export const enqueueDomainRecoveryMails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      dry_run: z.boolean().optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-reminders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        mode: "domain_recovery",
        tenant_id: data.tenant_id,
        dry_run: data.dry_run === true,
        ignore_quiet_hours: true,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? `Edge function error (${res.status})`);

    try {
      await (supabaseAdmin as any).from("activity_log").insert({
        action: "domain_recovery_versendet",
        entity_type: "tenant",
        entity_id: data.tenant_id,
        actor_id: context.userId,
        comment: `Recovery-Mails: ${json.sent ?? 0} gesendet, ${json.skipped ?? 0} übersprungen, ${json.failed ?? 0} fehlgeschlagen`,
      });
    } catch {}

    return json;
  });
