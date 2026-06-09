// Deno Edge Function: send-appointment-reminders
//
// Sendet 30 Minuten vor einem gebuchten Termin (bookings.booking_date +
// booking_time) eine Erinnerungs-Mail an den Mitarbeiter.
//
// Trigger: pg_cron / externer Cron alle 10 Min, POST mit { dry_run?: bool }
//   - Auth: x-cron-secret Header ODER ?key=<CRON_SECRET>
//
// Toleranzfenster: now+25min .. now+40min (deckt 10-Min-Cron sauber ab).
// Idempotenz: appointment_reminder_log.booking_id PRIMARY KEY.
//
// Tenant-Isolation: SMTP wird strikt aus profiles.tenant_id → tenants gezogen.
// Pausierte Tenants (emails_paused = true) werden komplett übersprungen.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Toleranzfenster um die 30-Min-Marke (Cron läuft alle 10 Min).
const WINDOW_LOW_MIN = 25;
const WINDOW_HIGH_MIN = 40;

const DEFAULT_SUBJECT = "Erinnerung: Dein Termin in 30 Minuten";
const DEFAULT_BODY = `Hallo {{first_name}},

kurze Erinnerung: dein Termin startet in 30 Minuten ({{appointment_time}} Uhr am {{appointment_date}}).

Bitte sei rechtzeitig bereit.

{{cta:Zum Portal|{{portal_link}}}}

Viele Grüße
{{tenant_name}}`;

interface TenantRow {
  id: string;
  name: string;
  domain: string | null;
  primary_domain: string | null;
  logo_url: string | null;
  primary_color: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to_email: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_password: string | null;
  email_signature: string | null;
  emails_paused: boolean | null;
  reminder_appointment_subject: string | null;
  reminder_appointment_body: string | null;
}

function hasValidSmtp(t: TenantRow | null | undefined): t is TenantRow {
  return !!(t && t.smtp_host && t.smtp_port && t.smtp_username && t.smtp_password && t.sender_email);
}

function portalHost(t: TenantRow): string {
  return `portal.${t.primary_domain ?? t.domain}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function authorize(req: Request, admin: any): Promise<{ ok: true } | { ok: false; status: number; msg: string }> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const url = new URL(req.url);
  const provided = req.headers.get("x-cron-secret") ?? url.searchParams.get("key");
  if (cronSecret && provided && provided === cronSecret) return { ok: true };

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!jwt) return { ok: false, status: 401, msg: "Unauthorized" };
  const { data: userRes, error: uErr } = await admin.auth.getUser(jwt);
  if (uErr || !userRes?.user) return { ok: false, status: 401, msg: "Unauthorized" };
  const { data: role } = await admin
    .from("user_roles").select("role")
    .eq("user_id", userRes.user.id).eq("role", "admin").maybeSingle();
  if (!role) return { ok: false, status: 403, msg: "Forbidden" };
  return { ok: true };
}

function renderTemplate(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v ?? "");
  }
  return out;
}

function buildHtml(subject: string, body: string, signature: string, tenant: TenantRow, vars: Record<string, string>): string {
  const color = tenant.primary_color || "#0f172a";
  const resolvedBody = renderTemplate(body, vars)
    .replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) => {
      return `<table cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${color};border-radius:8px"><a href="${String(href).trim()}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${String(label).trim()}</a></td></tr></table>`;
    });
  const bodyHtml = resolvedBody
    .replace(/\n/g, "<br>")
    .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${color};text-decoration:underline;">$1</a>`);
  const logoHtml = tenant.logo_url
    ? `<div style="text-align:center;margin-bottom:24px;"><img src="${tenant.logo_url}" alt="${tenant.name}" style="max-height:48px;max-width:200px;" /></div>`
    : "";
  const sigText = signature ? renderTemplate(signature, vars).replace(/\n/g, "<br>") : "";
  const sigHtml = sigText
    ? `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px;color:#9ca3af;font-size:13px;line-height:20px;">${sigText}</div>`
    : "";
  const subj = renderTemplate(subject, vars);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
<div style="background:#fff;border-radius:12px;padding:32px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
${logoHtml}
<h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 20px;line-height:1.3">${subj}</h1>
<div style="color:#374151;font-size:15px;line-height:26px">${bodyHtml}</div>
${sigHtml}
</div>
<div style="text-align:center;margin-top:16px;color:#9ca3af;font-size:11px">© ${new Date().getFullYear()} ${tenant.name}</div>
</div></body></html>`;
}

async function sendMail(tenant: TenantRow, to: string, subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: tenant.smtp_host!,
    port: tenant.smtp_port!,
    secure: tenant.smtp_port === 465,
    auth: { user: tenant.smtp_username!, pass: tenant.smtp_password! },
  });
  const senderName = tenant.sender_name ?? tenant.name;
  const senderEmail = tenant.sender_email ?? tenant.smtp_username!;
  await transporter.sendMail({
    from: `"${senderName}" <${senderEmail}>`,
    to,
    replyTo: tenant.reply_to_email ?? senderEmail,
    subject,
    html,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authz = await authorize(req, admin);
    if (!authz.ok) return json({ error: authz.msg }, authz.status);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run === true;

    const now = new Date();
    const low = new Date(now.getTime() + WINDOW_LOW_MIN * 60_000);
    const high = new Date(now.getTime() + WINDOW_HIGH_MIN * 60_000);

    // Tenants vorladen
    const { data: tList, error: tErr } = await admin
      .from("tenants")
      .select("id,name,domain,primary_domain,logo_url,primary_color,sender_email,sender_name,reply_to_email,smtp_host,smtp_port,smtp_username,smtp_password,email_signature,is_active,emails_paused,reminder_appointment_subject,reminder_appointment_body")
      .eq("is_active", true);
    if (tErr) return json({ error: tErr.message }, 500);
    const tenants = new Map<string, TenantRow>();
    (tList ?? []).forEach((t: any) => tenants.set(t.id, t as TenantRow));

    // Kandidaten-Bookings im Fenster
    const lowDate = low.toISOString().slice(0, 10);
    const highDate = high.toISOString().slice(0, 10);
    const dateList = lowDate === highDate ? [lowDate] : [lowDate, highDate];

    const { data: bookings, error: bErr } = await admin
      .from("bookings")
      .select("id,user_id,booking_date,booking_time,status")
      .in("booking_date", dateList)
      .in("status", ["booked", "confirmed", "scheduled", "accepted"]);
    if (bErr) return json({ error: bErr.message }, 500);

    const candidates: Array<{
      id: string;
      user_id: string;
      starts_at: Date;
      booking_date: string;
      booking_time: string;
    }> = [];
    for (const b of (bookings ?? []) as any[]) {
      if (!b.booking_date || !b.booking_time) continue;
      const starts = new Date(`${b.booking_date}T${b.booking_time}`);
      if (isNaN(starts.getTime())) continue;
      if (starts >= low && starts < high) {
        candidates.push({ id: b.id, user_id: b.user_id, starts_at: starts, booking_date: b.booking_date, booking_time: b.booking_time });
      }
    }

    if (candidates.length === 0) {
      return json({ success: true, dry_run: dryRun, window: { from: low.toISOString(), to: high.toISOString() }, candidates: 0, sent: 0, skipped: 0, failed: 0 });
    }

    // Bereits geloggte Bookings rausfiltern (Idempotenz)
    const ids = candidates.map(c => c.id);
    const { data: logged } = await admin
      .from("appointment_reminder_log")
      .select("booking_id")
      .in("booking_id", ids);
    const loggedSet = new Set((logged ?? []).map((r: any) => r.booking_id));
    const todo = candidates.filter(c => !loggedSet.has(c.id));

    // Profile laden
    const userIds = Array.from(new Set(todo.map(c => c.user_id))).filter(Boolean);
    const profileMap = new Map<string, { email: string | null; first_name: string | null; last_name: string | null; full_name: string | null; tenant_id: string | null }>();
    if (userIds.length > 0) {
      const { data: profs } = await admin
        .from("profiles")
        .select("user_id,email,first_name,last_name,full_name,tenant_id")
        .in("user_id", userIds);
      for (const p of (profs ?? []) as any[]) profileMap.set(p.user_id, p);
    }

    let sent = 0, skipped = 0, failed = 0;
    const results: Array<{ booking_id: string; status: string; reason?: string }> = [];

    for (const c of todo) {
      const prof = profileMap.get(c.user_id);
      if (!prof?.email || !prof?.tenant_id) {
        skipped++; results.push({ booking_id: c.id, status: "skipped", reason: "no_profile_or_email" }); continue;
      }
      const tenant = tenants.get(prof.tenant_id);
      if (!tenant) { skipped++; results.push({ booking_id: c.id, status: "skipped", reason: "tenant_missing" }); continue; }
      if (tenant.emails_paused) { skipped++; results.push({ booking_id: c.id, status: "skipped", reason: "tenant_paused" }); continue; }
      if (!hasValidSmtp(tenant)) { skipped++; results.push({ booking_id: c.id, status: "skipped", reason: "smtp_incomplete" }); continue; }

      if (dryRun) { sent++; results.push({ booking_id: c.id, status: "would_send" }); continue; }

      const subject = tenant.reminder_appointment_subject || DEFAULT_SUBJECT;
      const bodyT = tenant.reminder_appointment_body || DEFAULT_BODY;
      const vars: Record<string, string> = {
        first_name: prof.first_name || prof.full_name?.split(" ")[0] || "",
        last_name: prof.last_name || "",
        email: prof.email,
        tenant_name: tenant.name,
        appointment_date: new Date(`${c.booking_date}T00:00:00`).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }),
        appointment_time: c.booking_time.slice(0, 5),
        portal_link: `https://${portalHost(tenant)}/appointments`,
      };
      const renderedSubject = renderTemplate(subject, vars);
      const html = buildHtml(subject, bodyT, tenant.email_signature ?? "", tenant, vars);

      try {
        await sendMail(tenant, prof.email, renderedSubject, html);
        await admin.from("appointment_reminder_log").insert({
          booking_id: c.id, tenant_id: tenant.id, recipient_email: prof.email, status: "sent",
        });
        sent++; results.push({ booking_id: c.id, status: "sent" });
      } catch (e: any) {
        failed++;
        const errMsg = String(e?.message ?? e).slice(0, 500);
        await admin.from("appointment_reminder_log").insert({
          booking_id: c.id, tenant_id: tenant.id, recipient_email: prof.email, status: "failed", error: errMsg,
        });
        results.push({ booking_id: c.id, status: "failed", reason: errMsg });
      }
    }

    return json({
      success: true,
      dry_run: dryRun,
      window: { from: low.toISOString(), to: high.toISOString() },
      candidates: candidates.length,
      already_sent: candidates.length - todo.length,
      sent, skipped, failed,
      results: dryRun ? results : undefined,
    });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});
