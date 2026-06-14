import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

/**
 * Drip-Resend: Plant Einladungs-Mails an alle akzeptierten Bewerber OHNE Auth-Account.
 * Statt sofort zu senden, werden Rows in invite_resend_queue eingestellt mit
 * scheduled_at gleichmäßig über `windowHours` (Default 48) verteilt — pro Tenant
 * separat, damit jeder Tenant sein eigenes SMTP gleichmäßig auslastet.
 *
 * Worker: Edge Function process-invite-resend-queue (per pg_cron alle 15 min).
 */
export const resendInvitesToUnregistered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { windowHours?: number; dryRun?: boolean } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const windowHours = Math.min(Math.max(data.windowHours ?? 48, 1), 168); // 1h..7d
    const dryRun = !!data.dryRun;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    // 1) Auth-User-E-Mails einsammeln
    const existing = new Set<string>();
    for (let page = 1; page < 50; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(error.message);
      const users = data?.users ?? [];
      for (const u of users) if (u.email) existing.add(u.email.toLowerCase());
      if (users.length < 1000) break;
    }

    // 2) Akzeptierte Bewerbungen ohne Auth-Account
    const { data: apps, error } = await sb
      .from("applications")
      .select("id, email, full_name, first_name, last_name, tenant_id, status, created_at")
      .eq("status", "akzeptiert")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const targets = (apps ?? []).filter((a: any) => {
      const e = (a.email ?? "").toLowerCase();
      return e && !existing.has(e) && a.tenant_id;
    });

    if (targets.length === 0) {
      return { eligible: 0, queued: 0, windowHours, batchId: null as string | null };
    }

    // 3) Schon offen in der Queue? Skip, um Doppel-Einträge zu vermeiden.
    const { data: openRows } = await sb
      .from("invite_resend_queue")
      .select("application_id")
      .eq("status", "queued");
    const openSet = new Set<string>((openRows ?? []).map((r: any) => r.application_id));
    const fresh = targets.filter((a: any) => !openSet.has(a.id));

    if (fresh.length === 0) {
      return { eligible: targets.length, queued: 0, windowHours, batchId: null };
    }

    // 4) Per Tenant gruppieren und scheduled_at gleichmäßig über windowHours verteilen
    const batchId = crypto.randomUUID();
    const now = Date.now();
    const windowMs = windowHours * 60 * 60 * 1000;

    const byTenant = new Map<string, any[]>();
    for (const t of fresh) {
      if (!byTenant.has(t.tenant_id)) byTenant.set(t.tenant_id, []);
      byTenant.get(t.tenant_id)!.push(t);
    }

    const rows: any[] = [];
    for (const [tenantId, list] of byTenant) {
      const n = list.length;
      const step = n > 1 ? windowMs / n : 0;
      list.forEach((a: any, i: number) => {
        // kleine Zufallsstreuung ±2 min, damit Sends nicht exakt synchron laufen
        const jitter = Math.floor((Math.random() - 0.5) * 4 * 60 * 1000);
        rows.push({
          application_id: a.id,
          tenant_id: tenantId,
          email: a.email,
          full_name: a.full_name,
          first_name: a.first_name,
          last_name: a.last_name,
          scheduled_at: new Date(now + i * step + jitter).toISOString(),
          batch_id: batchId,
        });
      });
    }

    // 5) Insert in 500er-Chunks
    let queued = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error: insErr, count } = await sb
        .from("invite_resend_queue")
        .insert(chunk, { count: "exact" });
      if (insErr) throw new Error(insErr.message);
      queued += count ?? chunk.length;
    }

    return { eligible: targets.length, queued, windowHours, batchId };
  });

/**
 * Live-Status der Drip-Queue (für UI-Anzeige).
 */
export const getInviteResendQueueStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    const counts = { queued: 0, sent: 0, failed: 0, skipped: 0 };
    for (const status of Object.keys(counts) as Array<keyof typeof counts>) {
      const { count } = await sb
        .from("invite_resend_queue")
        .select("id", { head: true, count: "exact" })
        .eq("status", status);
      counts[status] = count ?? 0;
    }

    const { data: nextRow } = await sb
      .from("invite_resend_queue")
      .select("scheduled_at")
      .eq("status", "queued")
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: lastRow } = await sb
      .from("invite_resend_queue")
      .select("scheduled_at")
      .eq("status", "queued")
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      counts,
      nextScheduledAt: nextRow?.scheduled_at ?? null,
      lastScheduledAt: lastRow?.scheduled_at ?? null,
    };
  });
