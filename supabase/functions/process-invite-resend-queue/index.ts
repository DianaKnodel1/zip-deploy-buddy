// Deno Edge Function: process-invite-resend-queue
//
// Worker für die Drip-Queue invite_resend_queue.
// Zieht fällige Rows (scheduled_at <= now, status=queued), sendet via
// vorhandene Edge Function send-invitation-email (nutzt Tenant-SMTP, Pause,
// SMTP-Health). Pro Run hartes Cap, Quiet-Hours respektiert.
//
// Trigger: pg_cron alle 15 Minuten ODER manuell POST {}
//
// Deploy:
//   supabase functions deploy process-invite-resend-queue --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Ziel: ~1100 Mails in 24h. Sendefenster 06–22 Uhr (16h) = 64 Runs à 15 min.
// 1100 / 64 ≈ 18 → wir nehmen 25 für Headroom + Backlog-Catch-up.
// Auto-Skip nutzt jetzt eine billige profiles-Query (keine listUsers-Schleife
// mehr), darum ist die Wall-Clock pro Run unkritisch — der Bottleneck war
// vorher die User-Liste, nicht das Senden.
const MAX_PER_RUN = 25;
// Quiet-Hours (Europe/Berlin): aktiv außerhalb 06–22 Uhr
const QUIET_START = 6;
const QUIET_END = 22;

function berlinHour(): number {
  const h = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", hour: "2-digit", hour12: false,
  }).format(new Date());
  return parseInt(h, 10);
}
function isQuietHours(): boolean {
  const h = berlinHour();
  return h < QUIET_START || h >= QUIET_END;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const ignoreQuiet = body?.ignore_quiet_hours === true;

  if (isQuietHours() && !ignoreQuiet) {
    return json({ skipped: "quiet_hours", hour: berlinHour() }, 200);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 1) Fällige Rows ziehen
  const { data: due, error: dueErr } = await admin
    .from("invite_resend_queue")
    .select("id, application_id, tenant_id, email, full_name, first_name, last_name, attempts")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (dueErr) return json({ error: dueErr.message }, 500);
  if (!due || due.length === 0) return json({ processed: 0, sent: 0, failed: 0 }, 200);

  // 2a) Auto-Skip: nur prüfen, ob die KONKRETEN fälligen E-Mails bereits
  //     einen Auth-Account haben. Kein listUsers-Scan über ALLE User
  //     (war die Hauptursache für CPU/Wall-Clock-Timeouts).
  //     Wir nutzen eine billige profiles-Query (1 Roundtrip).
  const dueEmails = Array.from(new Set(
    due.map((r: any) => String(r.email ?? "").toLowerCase()).filter(Boolean),
  ));
  const registeredEmails = new Set<string>();
  if (dueEmails.length > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("email")
      .in("email", dueEmails);
    for (const p of (profs ?? []) as Array<{ email: string | null }>) {
      if (p.email) registeredEmails.add(p.email.toLowerCase());
    }
  }

  const dueFiltered: any[] = [];
  let autoSkipped = 0;
  for (const row of due) {
    if (row.email && registeredEmails.has(String(row.email).toLowerCase())) {
      await admin.from("invite_resend_queue").update({
        status: "skipped",
        last_error: "auto_skip_registered",
      }).eq("id", row.id);
      autoSkipped++;
    } else {
      dueFiltered.push(row);
    }
  }
  if (dueFiltered.length === 0) {
    return json({ processed: due.length, sent: 0, failed: 0, skipped: autoSkipped }, 200);
  }

  // 2b) Tenants vorladen (für portal-link)
  const tenantIds = Array.from(new Set(dueFiltered.map((r: any) => r.tenant_id)));
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, domain, primary_domain, emails_paused, is_active")
    .in("id", tenantIds);
  const tMap = new Map<string, any>();
  (tenants ?? []).forEach((t: any) => tMap.set(t.id, t));

  let sent = 0, failed = 0, skipped = autoSkipped;

  for (const row of dueFiltered) {
    const t = tMap.get(row.tenant_id);
    if (!t || t.is_active === false || t.emails_paused) {
      await admin.from("invite_resend_queue").update({
        status: "skipped",
        last_error: !t ? "tenant not found" : t.is_active === false ? "tenant inactive" : "tenant emails paused",
      }).eq("id", row.id);
      skipped++;
      continue;
    }
    const activeDomain = t.primary_domain ?? t.domain;
    const registrationLink = activeDomain ? `https://portal.${activeDomain}/register` : "";

    try {
      const { data, error } = await admin.functions.invoke("send-invitation-email", {
        body: {
          to: row.email,
          fullName: row.full_name,
          firstName: row.first_name,
          lastName: row.last_name,
          registrationLink,
          tenantId: row.tenant_id,
        },
      });
      if (error) throw new Error(error.message || "invoke failed");
      if ((data as any)?.error) throw new Error((data as any).error);

      await admin.from("invite_resend_queue").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        attempts: (row.attempts ?? 0) + 1,
      }).eq("id", row.id);
      sent++;
    } catch (e: any) {
      const attempts = (row.attempts ?? 0) + 1;
      await admin.from("invite_resend_queue").update({
        status: attempts >= 3 ? "failed" : "queued",
        attempts,
        last_error: String(e?.message ?? e).slice(0, 500),
        scheduled_at: attempts >= 3 ? undefined : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }).eq("id", row.id);
      failed++;
    }

    // kleine Streuung zwischen Sends (kurz halten — Edge-Runtime-Wall-Limit)
    await new Promise(r => setTimeout(r, 200 + Math.floor(Math.random() * 300)));
  }

  return json({ processed: due.length, sent, failed, skipped }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
