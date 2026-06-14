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
 * Sendet allen akzeptierten Bewerbern, die noch KEINEN Auth-Account haben,
 * erneut die Einladungs-Mail (Portal-Link zur Registrierung).
 * Umgeht die 3-Tage-/Cap-Sperren von send-reminders. Idempotent über message_id ist NICHT garantiert
 * — gedacht als manuelle "Resend"-Aktion, nicht für Cron.
 */
export const resendInvitesToUnregistered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    // 1) Tenants für Portal-Link
    const { data: tenants } = await sb.from("tenants").select("id, domain, primary_domain");
    const tenantMap = new Map<string, { domain: string; primary_domain: string | null }>();
    (tenants ?? []).forEach((t: any) => tenantMap.set(t.id, { domain: t.domain, primary_domain: t.primary_domain ?? null }));

    // 2) Auth-User-E-Mails einsammeln (alle Seiten)
    const existing = new Set<string>();
    for (let page = 1; page < 50; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(error.message);
      const users = data?.users ?? [];
      for (const u of users) if (u.email) existing.add(u.email.toLowerCase());
      if (users.length < 1000) break;
    }

    // 3) Akzeptierte Bewerbungen ohne Auth-Account
    const { data: apps, error } = await sb
      .from("applications")
      .select("id, email, full_name, first_name, last_name, tenant_id, status")
      .eq("status", "akzeptiert");
    if (error) throw new Error(error.message);

    const targets = (apps ?? []).filter((a: any) => {
      const e = (a.email ?? "").toLowerCase();
      return e && !existing.has(e) && a.tenant_id;
    });

    let sent = 0;
    const failures: Array<{ email: string; reason: string }> = [];

    // Batches à 5
    for (let i = 0; i < targets.length; i += 5) {
      const batch = targets.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(async (app: any) => {
          const t = tenantMap.get(app.tenant_id);
          const activeDomain = t?.primary_domain ?? t?.domain ?? null;
          const registrationLink = activeDomain ? `https://portal.${activeDomain}/register` : "";
          const { data, error } = await sb.functions.invoke("send-invitation-email", {
            body: {
              to: app.email,
              fullName: app.full_name,
              firstName: app.first_name,
              lastName: app.last_name,
              registrationLink,
              tenantId: app.tenant_id,
            },
          });
          if (error) throw new Error(error.message || "send failed");
          if ((data as any)?.error) throw new Error((data as any).error);
        }),
      );
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") sent++;
        else failures.push({ email: batch[idx].email, reason: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      });
    }

    return { eligible: targets.length, sent, failed: failures.length, failures: failures.slice(0, 10) };
  });
