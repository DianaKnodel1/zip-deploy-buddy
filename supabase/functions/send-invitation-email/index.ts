// Deno Edge Function: send-invitation-email
//
// Wird beim Akzeptieren einer Bewerbung gerufen (admin.applications.$appId.tsx).
// Sendet eine Willkommens-/Einladungs-Mail mit Registrierungs-Link über die
// Tenant-SMTP. Respektiert tenants.emails_paused und nutzt verifyOrPause für
// Auto-Pause nach 3 SMTP-Verify-Fails (analog zu resend-signup-confirmation).
//
// Deploy:
//   supabase functions deploy send-invitation-email --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  to: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  registrationLink: string;
  tenantId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { to, fullName, firstName, lastName, registrationLink, tenantId } =
      (await req.json()) as Payload;

    if (!to || !registrationLink || !tenantId) {
      return json({ error: "Missing required fields: to, registrationLink, tenantId" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const supabase = supabaseAdmin;

    const { data: tenant, error: tErr } = await supabaseAdmin
      .from("tenants")
      .select("id, name, domain, logo_url, primary_color, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, is_active, emails_paused, emails_paused_reason")
      .eq("id", tenantId)
      .maybeSingle();
    if (tErr || !tenant) return json({ error: "Tenant nicht gefunden" }, 404);
    if (tenant.is_active === false) {
      return json({ error: "Tenant ist deaktiviert — kein E-Mail-Versand.", inactive: true }, 503);
    }
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
      return json({ error: "Tenant hat keine vollständige SMTP-Konfiguration" }, 400);
    }
    if (tenant.emails_paused) {
      return json({
        error: `E-Mail-Versand für diesen Mandanten ist pausiert${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}.`,
        paused: true,
      }, 503);
    }

    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email ?? tenant.smtp_username;
    const brand = tenant.primary_color ?? "#0f172a";
    const greetingName = firstName || fullName || "willkommen";
    const subject = `Deine Bewerbung wurde angenommen – ${tenant.name}`;

    const logo = tenant.logo_url
      ? `<img src="${tenant.logo_url}" alt="${escapeHtml(tenant.name)}" style="max-height:40px;margin-bottom:24px"/>`
      : `<div style="font-weight:700;font-size:20px;margin-bottom:24px;color:${brand}">${escapeHtml(tenant.name)}</div>`;

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;max-width:560px">
<tr><td>
${logo}
<h1 style="font-size:24px;margin:0 0 16px;color:#0f172a">Hallo ${escapeHtml(greetingName)},</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px">
deine Bewerbung bei <strong>${escapeHtml(tenant.name)}</strong> wurde angenommen — herzlich willkommen!
</p>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 24px">
Im nächsten Schritt legst du dein Konto an und schließt dein Onboarding ab. Klicke dafür auf den Button:
</p>
<table cellpadding="0" cellspacing="0"><tr><td style="background:${brand};border-radius:8px">
<a href="${registrationLink}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">Jetzt registrieren</a>
</td></tr></table>
<p style="font-size:13px;color:#94a3b8;margin:32px 0 0;line-height:1.5">
Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br/>
<a href="${registrationLink}" style="color:${brand};word-break:break-all">${registrationLink}</a>
</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0"/>
<p style="font-size:12px;color:#94a3b8;margin:0">
Diese E-Mail wurde an ${escapeHtml(to)} gesendet.
</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

    const transporter = nodemailer.createTransport({
      host: tenant.smtp_host,
      port: tenant.smtp_port,
      secure: tenant.smtp_port === 465,
      auth: { user: tenant.smtp_username, pass: tenant.smtp_password },
    });

    const smtpMeta = {
      smtp_host: tenant.smtp_host,
      smtp_port: tenant.smtp_port,
      smtp_secure: tenant.smtp_port === 465,
      smtp_username: tenant.smtp_username,
      from_email: senderEmail,
      from_name: senderName,
      reply_to: tenant.reply_to_email ?? senderEmail,
      subject,
      tenant_id: tenant.id,
      tenant_name: tenant.name,
    };

    const verifyRes = await verifyOrPause(supabaseAdmin, tenant, transporter);
    if (!verifyRes.ok) {
      await logSend(supabaseAdmin, tenant.id, to, subject, html, senderEmail, "failed", verifyRes.reason, smtpMeta);
      return json({ error: `SMTP-Verbindung fehlgeschlagen: ${verifyRes.reason}`, paused: verifyRes.paused }, 502);
    }

    try {
      const info = await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to,
        replyTo: tenant.reply_to_email ?? senderEmail,
        subject,
        html,
      });
      await logSend(supabaseAdmin, tenant.id, to, subject, html, senderEmail, "sent", undefined, { ...smtpMeta, message_id: info?.messageId ?? null });
      return json({ success: true }, 200);
    } catch (sendErr: any) {
      const reason = String(sendErr?.message ?? sendErr);
      await logSend(supabaseAdmin, tenant.id, to, subject, html, senderEmail, "failed", reason, smtpMeta);
      return json({ error: `E-Mail konnte nicht gesendet werden: ${reason}` }, 502);
    }
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function logSend(admin: any, tenantId: string, to: string, subject: string, html: string, senderEmail: string, status: string, error?: string, metadata?: Record<string, unknown>) {
  try {
    await admin.from("email_send_log").insert({
      tenant_id: tenantId,
      template_name: "invitation",
      recipient_email: to,
      status,
      error_message: error ?? null,
      rendered_subject: subject,
      rendered_html: html,
      sender_email: senderEmail,
      metadata: metadata ?? null,
    });
  } catch { /* non-critical */ }
}

async function verifyOrPause(admin: any, tenant: any, transporter: any): Promise<{ ok: boolean; reason?: string; paused?: boolean }> {
  try {
    await Promise.race([
      transporter.verify(),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("verify timeout 8s")), 8000)),
    ]);
    await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: 0,
      last_verify_at: new Date().toISOString(), last_verify_ok: true, updated_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e: any) {
    const reason = String(e?.message ?? e);
    const { data: h } = await admin.from("tenant_smtp_health").select("consecutive_fails").eq("tenant_id", tenant.id).maybeSingle();
    const fails = (h?.consecutive_fails ?? 0) + 1;
    await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: fails,
      last_fail_at: new Date().toISOString(), last_fail_error: reason,
      last_verify_at: new Date().toISOString(), last_verify_ok: false, updated_at: new Date().toISOString(),
    });
    let paused = false;
    if (fails >= 3 && !tenant.emails_paused) {
      await admin.from("tenants").update({
        emails_paused: true,
        emails_paused_at: new Date().toISOString(),
        emails_paused_reason: `SMTP-Verify ${fails}x fehlgeschlagen: ${reason}`,
        emails_paused_by: "auto:smtp_verify",
      }).eq("id", tenant.id);
      await admin.from("activity_log").insert({
        action: "emails_auto_pausiert", entity_type: "tenant", entity_id: tenant.id,
        comment: `SMTP-Versand auto-pausiert nach ${fails} Verify-Fails: ${reason}`,
      }).then(() => {}, () => {});
      paused = true;
    }
    return { ok: false, reason, paused };
  }
}
