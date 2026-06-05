import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Heartbeat: setzt profiles.last_seen_at = now() für den eingeloggten User.
 * Wird vom Browser alle ~60s aufgerufen, solange ein Tab offen ist.
 */
export const updateLastSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await (context.supabase as any)
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
