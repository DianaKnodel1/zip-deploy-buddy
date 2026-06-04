import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Schema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(500),
});

export const getLastSignIns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Schema.parse(input))
  .handler(async ({ data, context }) => {
    // Admin-Gate: nur Admins dürfen Login-Zeitstempel fremder User abfragen.
    const { data: roleRow, error: roleErr } = await (context.supabase as any)
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    const { data: rows, error } = await (context.supabase as any).rpc(
      "get_last_sign_ins",
      { _user_ids: data.user_ids },
    );
    if (error) throw new Error(error.message);
    const map: Record<string, string | null> = {};
    for (const r of (rows ?? []) as Array<{ user_id: string; last_sign_in_at: string | null }>) {
      map[r.user_id] = r.last_sign_in_at;
    }
    return map;
  });
