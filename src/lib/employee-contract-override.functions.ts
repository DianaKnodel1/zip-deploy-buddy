import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Pro-Mitarbeiter Override des Arbeitsvertrags – entweder als HTML-Body
// (Admin editiert die Tenant-Vorlage frei) oder als hochgeladenes PDF.
// Zusätzlich kann ein individuelles Monatsgehalt + Wochenstunden hinterlegt
// werden. Wenn ein Override existiert, sieht der Mitarbeiter auf /contract
// diese Werte statt der Standard-Tenant-Vorlage.

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

const UserIdSchema = z.object({ user_id: z.string().uuid() });

export const getContractOverride = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UserIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("employee_contract_overrides")
      .select("*")
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { override: row ?? null };
  });

async function loadProfile(sb: any, userId: string) {
  const { data } = await sb
    .from("profiles")
    .select("tenant_id, contract_signed_at, full_name")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

async function logOverride(sb: any, params: {
  action: string;
  userId: string;
  actorId: string;
  prof: any;
  comment: string;
}) {
  try {
    await sb.from("activity_log").insert({
      action: params.action,
      entity_type: "profile",
      entity_id: params.userId,
      actor_id: params.actorId,
      comment: params.comment,
      old_status: params.prof?.contract_signed_at ? "unterschrieben" : "offen",
      new_status: "offen",
    });
  } catch {}
}

export const saveContractOverrideHtml = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      html_body: z.string().min(10).max(200_000),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const prof = await loadProfile(sb, data.user_id);

    const { error } = await sb
      .from("employee_contract_overrides")
      .upsert(
        {
          user_id: data.user_id,
          tenant_id: prof?.tenant_id ?? null,
          html_body: data.html_body,
          pdf_url: null,
          created_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);

    await sb.from("profiles").update({ contract_signed_at: null }).eq("user_id", data.user_id);
    await logOverride(sb, {
      action: "vertrag_override_html",
      userId: data.user_id,
      actorId: context.userId,
      prof,
      comment: `Individueller Arbeitsvertrag (Text) hinterlegt für ${prof?.full_name ?? "Mitarbeiter"}.`,
    });

    return { ok: true };
  });

export const saveContractOverridePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      pdf_url: z.string().min(1).max(1000),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const prof = await loadProfile(sb, data.user_id);

    const { error } = await sb
      .from("employee_contract_overrides")
      .upsert(
        {
          user_id: data.user_id,
          tenant_id: prof?.tenant_id ?? null,
          html_body: null,
          pdf_url: data.pdf_url,
          created_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);

    await sb.from("profiles").update({ contract_signed_at: null }).eq("user_id", data.user_id);
    await logOverride(sb, {
      action: "vertrag_override_pdf",
      userId: data.user_id,
      actorId: context.userId,
      prof,
      comment: `Individueller Arbeitsvertrag (PDF) hochgeladen für ${prof?.full_name ?? "Mitarbeiter"}.`,
    });

    return { ok: true };
  });

// Neu: Gehalt + Wochenstunden separat (oder zusammen mit html/pdf) updaten.
// Wenn nur diese Felder gesetzt werden, behalten wir html_body/pdf_url bei.
export const saveContractOverrideSalary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      monthly_salary_cents: z.number().int().min(0).max(100_000_00).nullable(),
      weekly_hours: z.number().min(0).max(80).nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const prof = await loadProfile(sb, data.user_id);

    // Falls noch kein Override existiert: anlegen, ohne html/pdf zu erzwingen.
    const { data: existing } = await sb
      .from("employee_contract_overrides")
      .select("id")
      .eq("user_id", data.user_id)
      .maybeSingle();

    if (existing) {
      const { error } = await sb
        .from("employee_contract_overrides")
        .update({
          monthly_salary_cents: data.monthly_salary_cents,
          weekly_hours: data.weekly_hours,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", data.user_id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb
        .from("employee_contract_overrides")
        .insert({
          user_id: data.user_id,
          tenant_id: prof?.tenant_id ?? null,
          monthly_salary_cents: data.monthly_salary_cents,
          weekly_hours: data.weekly_hours,
          created_by: context.userId,
        });
      if (error) throw new Error(error.message);
    }

    await logOverride(sb, {
      action: "vertrag_override_salary",
      userId: data.user_id,
      actorId: context.userId,
      prof,
      comment: `Individuelles Gehalt / Wochenstunden aktualisiert für ${prof?.full_name ?? "Mitarbeiter"}.`,
    });

    return { ok: true };
  });

export const deleteContractOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UserIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("employee_contract_overrides")
      .delete()
      .eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Mitarbeiter-Sicht: Override für den eigenen Account holen.
export const getMyContractOverride = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("employee_contract_overrides")
      .select("html_body, pdf_url, monthly_salary_cents, weekly_hours, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { override: data ?? null };
  });
