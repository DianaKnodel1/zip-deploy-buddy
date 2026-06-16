import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

export type CronStatus = {
  key: string;
  label: string;
  description: string;
  schedule: string;
  expected_max_age_min: number;
  last_activity_at: string | null;
  age_min: number | null;
  severity: "green" | "yellow" | "red" | "unknown";
  hint: string | null;
};

/**
 * Indirekte Cron-Health: misst NICHT pg_cron.job_run_details (kein Zugriff aus
 * PostgREST), sondern die *Auswirkung* jedes Crons in den fachlichen Tabellen.
 * Kein Eintrag im erwarteten Fenster → Cron läuft vermutlich nicht.
 */
export const getCronHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const sb = supabaseAdmin as any;

    const latest = async (table: string, col: string): Promise<string | null> => {
      const { data } = await sb.from(table).select(col).order(col, { ascending: false }).limit(1).maybeSingle();
      return (data as any)?.[col] ?? null;
    };

    const remLast = await latest("reminder_log", "sent_at");
    const dripLast = await latest("invite_resend_queue", "updated_at");
    const apptLast = await latest("appointment_reminder_log", "sent_at");

    const now = Date.now();
    const ageMin = (iso: string | null) => iso ? Math.floor((now - new Date(iso).getTime()) / 60_000) : null;
    const sev = (age: number | null, expected: number): CronStatus["severity"] => {
      if (age === null) return "unknown";
      if (age <= expected) return "green";
      if (age <= expected * 4) return "yellow";
      return "red";
    };

    const items: CronStatus[] = [
      {
        key: "send-reminders-hourly",
        label: "Reminder-Cron",
        description: "Stündlich (Minute 15). Sendet Invite-, Confirm- und Onboarding-Reminder.",
        schedule: "15 * * * *",
        expected_max_age_min: 90, // 1h + Puffer
        last_activity_at: remLast,
        age_min: ageMin(remLast),
        severity: sev(ageMin(remLast), 90),
        hint: "Aktivität gemessen am letzten reminder_log-Eintrag.",
      },
      {
        key: "process-invite-resend-queue",
        label: "Drip-Queue (Bewerber-Einladungen)",
        description: "Alle 15 Min. Sendet eingereihte Bewerber-Einladungen mit Quiet-Hours 23–05.",
        schedule: "*/15 * * * *",
        expected_max_age_min: 30,
        last_activity_at: dripLast,
        age_min: ageMin(dripLast),
        severity: sev(ageMin(dripLast), 30),
        hint: "Aktivität gemessen am letzten invite_resend_queue.updated_at. Nachts erwartet kein Update.",
      },
      {
        key: "send-appointment-reminders",
        label: "Termin-Erinnerung (30 Min vorher)",
        description: "Alle 10 Min. Sendet je Booking genau 1× eine 30-Min-Erinnerung.",
        schedule: "*/10 * * * *",
        expected_max_age_min: 60 * 24, // ein Tag — kein Booking ≠ Cron tot
        last_activity_at: apptLast,
        age_min: ageMin(apptLast),
        severity: apptLast ? sev(ageMin(apptLast), 60 * 24) : "unknown",
        hint: "Aktivität gemessen am letzten appointment_reminder_log. Wenn keine Termine anstanden, bleibt unbekannt.",
      },
    ];

    return { items, generated_at: new Date().toISOString() };
  });
