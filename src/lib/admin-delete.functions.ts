import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DeleteSchema = z.object({
  user_id: z.string().uuid(),
  confirm: z.literal("MITARBEITER LÖSCHEN"),
});

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

export const deleteEmployeeAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    if (data.user_id === context.userId) {
      throw new Error("Du kannst dich nicht selbst löschen");
    }

    const uid = data.user_id;
    const sb = supabaseAdmin as any;

    // 1) Storage-Cleanup (vor DB-Delete, damit Buckets sauber sind)
    for (const bucket of ["kyc-documents", "documents", "task-submissions"] as const) {
      try {
        const { data: files } = await sb.storage.from(bucket).list(uid, { limit: 1000 });
        if (files && files.length > 0) {
          const paths = files.map((f: any) => `${uid}/${f.name}`);
          await sb.storage.from(bucket).remove(paths);
        }
      } catch (e) {
        console.warn(`Storage-Cleanup ${bucket} fehlgeschlagen:`, e);
      }
    }

    // 2) Dynamisches Cascade-Cleanup via RPC (findet alle FKs auf auth.users)
    const { error: rpcErr } = await sb.rpc("admin_delete_user_cascade", {
      _user_id: uid,
      _actor_id: context.userId,
    });
    if (rpcErr) {
      throw new Error(`Cascade-Löschung fehlgeschlagen: ${rpcErr.message}`);
    }

    // 2) Auth-User löschen
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (authErr) {
      throw new Error(`Auth-Löschung fehlgeschlagen: ${authErr.message}`);
    }

    try {
      await sb.from("activity_log").insert({
        action: "mitarbeiter_geloescht",
        entity_type: "profile",
        entity_id: uid,
        actor_id: context.userId,
        comment: "Mitarbeiter hart gelöscht (inkl. Auth-Account)",
      });
    } catch {}

    return { ok: true };
  });
