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
  kind: "bewerber" | "mitarbeiter" | "bewerber_akzeptiert";
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

    // Mitarbeiter: ALLE inkl. abgeschlossen (außer deaktiviert/abgelehnt/gesperrt) —
    // matched die Filterung in der Edge-Function, damit „X Empfänger" stimmt.
    const { data: profiles, error: pErr } = await sb
      .from("profiles")
      .select("id,user_id,full_name,phone,status,onboarding_status,last_reminder_sent_at,created_at")
      .eq("tenant_id", data.tenant_id)
      .not("status", "in", '("deaktiviert","abgelehnt","gesperrt")');
    if (pErr) throw new Error(pErr.message);

    // Akzeptierte Bewerber ohne Auth-Account — siehe Edge-Function-Logik.
    const { data: apps, error: aErr } = await sb
      .from("applications")
      .select("id,email,full_name,first_name,phone,status,created_at,updated_at")
      .eq("tenant_id", data.tenant_id)
      .eq("status", "akzeptiert");
    if (aErr) throw new Error(aErr.message);

    const { data: usersList } = await sb.auth.admin.listUsers({ page: 1, perPage: 5000 });
    const emailByUserId = new Map<string, string>(
      (usersList?.users ?? []).map((u: any) => [u.id, (u.email ?? "").toLowerCase()])
    );
    const userEmails = new Set<string>(
      (usersList?.users ?? []).map((u: any) => (u.email ?? "").toLowerCase()).filter(Boolean)
    );

    const recipients: AffectedRecipient[] = [];
    const seen = new Set<string>();
    for (const p of profiles ?? []) {
      const email = emailByUserId.get(p.user_id) ?? null;
      if (email) {
        if (seen.has(email)) continue;
        seen.add(email);
      }
      recipients.push({
        kind: "mitarbeiter",
        id: p.user_id,
        name: p.full_name ?? "",
        email,
        phone: p.phone ?? null,
        status: p.status ?? p.onboarding_status ?? "",
        last_contact: p.last_reminder_sent_at ?? p.created_at ?? null,
      });
    }
    for (const app of apps ?? []) {
      const email = (app.email ?? "").toLowerCase();
      if (!email) continue;
      if (userEmails.has(email)) continue; // hat schon Account → läuft als „mitarbeiter"
      if (seen.has(email)) continue;
      seen.add(email);
      recipients.push({
        kind: "bewerber_akzeptiert",
        id: app.id,
        name: app.full_name ?? app.first_name ?? "",
        email,
        phone: app.phone ?? null,
        status: "akzeptiert (Bewerber)",
        last_contact: app.updated_at ?? app.created_at ?? null,
      });
    }

    return { recipients, count: recipients.length };
  });

// ============================================================
// 4a) Recovery-Status pro Empfänger (für UI-Tabelle)
// ============================================================

export interface RecoveryStatusEntry {
  email: string;
  status: "sent" | "failed" | "pending";
  sent_at: string | null;
  error: string | null;
}

export const getRecoveryStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ tenant_id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = supabaseAdmin as any;

    const { data: tenant } = await sb
      .from("tenants")
      .select("primary_domain_changed_at")
      .eq("id", data.tenant_id)
      .maybeSingle();
    const changedAt: string | null = tenant?.primary_domain_changed_at ?? null;
    if (!changedAt) {
      return { changed_at: null as string | null, entries: [] as RecoveryStatusEntry[] };
    }

    const { data: logs, error } = await sb
      .from("reminder_log")
      .select("email,status,sent_at,error")
      .eq("tenant_id", data.tenant_id)
      .eq("reminder_type", "domain_recovery")
      .gte("sent_at", changedAt)
      .order("sent_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Pro E-Mail nur den neuesten Eintrag behalten
    const seen = new Set<string>();
    const entries: RecoveryStatusEntry[] = [];
    for (const r of logs ?? []) {
      const email = String((r as any).email).toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      entries.push({
        email,
        status: (r as any).status,
        sent_at: (r as any).sent_at,
        error: (r as any).error ?? null,
      });
    }

    return { changed_at: changedAt, entries };
  });

// ============================================================
// 4b) Recovery-Mail-Vorschau (HTML + Subject)
// ============================================================

export const getRecoveryPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ tenant_id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = supabaseAdmin as any;
    const { data: t, error } = await sb
      .from("tenants")
      .select("id,name,domain,primary_domain,logo_url,primary_color,reminder_recovery_subject,reminder_recovery_body")
      .eq("id", data.tenant_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!t) throw new Error("Tenant nicht gefunden");

    const portalHost = `portal.${t.primary_domain ?? t.domain}`;
    const portalLink = `https://${portalHost}/login`;
    const sampleVars: Record<string, string> = {
      first_name: "Max",
      tenant_name: t.name,
      company_name: t.name,
      portal_link: portalLink,
      login_link: portalLink,
      confirmation_link: portalLink,
      booking_link: portalLink,
      email: "max@example.com",
      sender_name: t.name,
      support_email: "",
    };

    const DEFAULT_SUBJECT = "Wichtig: Neuer Portal-Link für {{tenant_name}}";
    const DEFAULT_BODY = `<h1 style="font-size:22px;margin:0 0 16px;color:#0f172a">Dein neuer Portal-Link</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px">Hallo {{first_name}},</p>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 24px">unsere bisherige Portal-Adresse ist nicht mehr erreichbar. Bitte nutze ab sofort den folgenden Link, um dich bei <strong>{{tenant_name}}</strong> einzuloggen:</p>
{{cta:Zum neuen Portal|{{portal_link}}}}
<p style="font-size:13px;color:#94a3b8;margin:24px 0 0">Oder kopiere diesen Link: {{portal_link}}</p>`;

    const replaceVars = (s: string) => {
      let out = s;
      for (let i = 0; i < 3; i++) {
        out = out.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) =>
          Object.prototype.hasOwnProperty.call(sampleVars, k) ? sampleVars[k] : m,
        );
      }
      return out;
    };
    const escapeHtml = (s: string) =>
      s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

    const subjectTpl = (t.reminder_recovery_subject && t.reminder_recovery_subject.trim()) ? t.reminder_recovery_subject : DEFAULT_SUBJECT;
    let body = (t.reminder_recovery_body && t.reminder_recovery_body.trim()) ? t.reminder_recovery_body : DEFAULT_BODY;
    const looksLikeHtml = /<\/?(p|h1|h2|h3|div|br|table|a)\b/i.test(body);
    if (!looksLikeHtml) body = escapeHtml(body).replace(/\n/g, "<br>");
    body = replaceVars(body);
    const brand = t.primary_color ?? "#0f172a";
    body = body.replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) =>
      `<table cellpadding="0" cellspacing="0"><tr><td style="background:${brand};border-radius:8px"><a href="${String(href).trim()}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">${String(label).trim()}</a></td></tr></table>`,
    );

    const logo = t.logo_url
      ? `<img src="${t.logo_url}" alt="${escapeHtml(t.name)}" style="max-height:40px;margin-bottom:24px"/>`
      : `<div style="font-weight:700;font-size:20px;margin-bottom:24px;color:${brand}">${escapeHtml(t.name)}</div>`;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;max-width:560px">
<tr><td>${logo}${body}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0"/>
<p style="font-size:12px;color:#94a3b8;margin:0">Vorschau · so sieht die Mail für deine Empfänger aus.</p>
</td></tr></table></td></tr></table></body></html>`;

    return { subject: replaceVars(subjectTpl), html, portal_link: portalLink };
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
