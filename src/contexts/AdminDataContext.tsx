import { useEffect, useState, useCallback, useRef, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { checkRiskFlag, type EmployeeStatus, type KycStatus, type OnboardingStatus } from "@/lib/status";
export type { EmployeeStatus, KycStatus, OnboardingStatus };
import { useToast } from "@/hooks/use-toast";
import { fetchAll } from "@/lib/fetch-all";

export interface Application {
  id: string; full_name: string; first_name: string | null; last_name: string | null;
  email: string; phone: string | null; message: string | null; status: string; created_at: string; tenant_id: string | null;
  address: string | null; postal_code: string | null; city: string | null;
  birth_date: string | null; birth_place: string | null; nationality: string | null;
}
export interface ProfileRow {
  id: string; user_id: string; full_name: string; status: EmployeeStatus; address: string | null; birth_date: string | null;
  living_since: string | null; created_at: string; contract_signed_at: string | null; onboarding_status: OnboardingStatus;
  admin_notes: string | null;
}
export interface KycRow {
  id: string; user_id: string; status: KycStatus; id_front_url: string | null; id_back_url: string | null; selfie_url: string | null;
  rejection_reason: string | null; risk_flag: boolean; reviewed_at: string | null;
}
export interface TaskTemplate {
  id: string; title: string; description: string; instructions: string; compensation: number; is_active: boolean; created_at: string;
}
export interface TaskQuestion { id: string; question: string; sort_order: number; }
export interface AssignmentRow {
  id: string; task_template_id: string; user_id: string; status: string; admin_comment: string | null; created_at: string; sms_channel_id: string | null;
}
export interface SubmissionRow {
  id: string; assignment_id: string; notes: string | null; file_urls: string[]; submitted_at: string;
}
export interface SubmissionAnswerRow { id: string; question_id: string; answer: string; }
export interface TimeSlotRow { id: string; slot_date: string; start_time: string; end_time: string; max_participants: number; created_at: string; }
export interface BookingRow { id: string; user_id: string; time_slot_id: string | null; assignment_id: string | null; status: string; created_at: string; booking_date: string | null; booking_time: string | null; }
export interface TransactionRow { id: string; user_id: string; assignment_id: string; amount: number; status: string; created_at: string; }
export interface ChatConversationRow { id: string; user_id: string; status: string; escalated_at: string | null; created_at: string; updated_at: string; }

interface AdminDataContextType {
  applications: Application[];
  profiles: ProfileRow[];
  kycList: KycRow[];
  templates: TaskTemplate[];
  assignments: AssignmentRow[];
  timeSlots: TimeSlotRow[];
  allBookings: BookingRow[];
  allTransactions: TransactionRow[];
  chatConversations: ChatConversationRow[];
  adminUserIds: Set<string>;
  emailConfirmedUserIds: Set<string>;
  loading: boolean;
  loadData: () => Promise<void>;
  setProfiles: React.Dispatch<React.SetStateAction<ProfileRow[]>>;
  setKycList: React.Dispatch<React.SetStateAction<KycRow[]>>;
  setAllTransactions: React.Dispatch<React.SetStateAction<TransactionRow[]>>;
  getProfileForUser: (userId: string) => ProfileRow | undefined;
}

const AdminDataContext = createContext<AdminDataContextType | null>(null);

export function useAdminData() {
  const ctx = useContext(AdminDataContext);
  if (!ctx) throw new Error("useAdminData must be used within AdminDataProvider");
  return ctx;
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [applications, setApplications] = useState<Application[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [kycList, setKycList] = useState<KycRow[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlotRow[]>([]);
  const [allBookings, setAllBookings] = useState<BookingRow[]>([]);
  const [allTransactions, setAllTransactions] = useState<TransactionRow[]>([]);
  const [chatConversations, setChatConversations] = useState<ChatConversationRow[]>([]);
  const [adminUserIds, setAdminUserIds] = useState<Set<string>>(new Set());
  const [emailConfirmedUserIds, setEmailConfirmedUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const loadData = useCallback(async () => {
    // Re-entry-Guard: laufende Ladevorgänge mergen, statt parallel zu starten
    if (inFlightRef.current) return inFlightRef.current;
    setLoading(true);

    const getValue = <T,>(
      result: PromiseSettledResult<T>,
      fallback: T,
      label: string,
      failures: string[],
    ): T => {
      if (result.status === "fulfilled") return result.value;
      failures.push(label);
      console.error(`[AdminData] ${label} konnte nicht geladen werden`, result.reason);
      return fallback;
    };

    const run = (async () => {
      try {
        // KEINE Limits — fetchAll() paginiert in 1000er-Chunks, bis ALLES geladen ist.
        const results = await Promise.allSettled([
          fetchAll<Application>(() => supabase.from("applications").select("*").order("created_at", { ascending: false })),
          fetchAll<ProfileRow>(() => supabase.from("profiles").select("*").order("created_at", { ascending: false })),
          fetchAll<KycRow>(() => supabase.from("kyc_verifications").select("*").order("created_at", { ascending: false })),
          fetchAll<TaskTemplate>(() => supabase.from("task_templates").select("*").order("created_at", { ascending: false })),
          fetchAll<AssignmentRow>(() => supabase.from("task_assignments").select("*").order("created_at", { ascending: false })),
          fetchAll<TimeSlotRow>(() => supabase.from("time_slots").select("*").order("slot_date", { ascending: false })),
          fetchAll<BookingRow>(() => supabase.from("bookings").select("*").order("created_at", { ascending: false })),
          fetchAll<TransactionRow>(() => supabase.from("user_transactions").select("*").order("created_at", { ascending: false })),
          fetchAll<ChatConversationRow>(() => supabase.from("chat_conversations").select("*").order("created_at", { ascending: false })),
          fetchAll<{ user_id: string; role: string }>(() => supabase.from("user_roles").select("user_id, role").eq("role", "admin")),
          (supabase as any).rpc("admin_get_email_confirmations").then((r: any) => r.data ?? []),
        ]);

        const failures: string[] = [];
        const apps = getValue(results[0], [] as Application[], "Bewerbungen", failures);
        const profileData = getValue(results[1], [] as ProfileRow[], "Mitarbeiter", failures);
        const kycData = getValue(results[2], [] as KycRow[], "KYC", failures);
        const templatesData = getValue(results[3], [] as TaskTemplate[], "Aufgaben-Vorlagen", failures);
        const assignData = getValue(results[4], [] as AssignmentRow[], "Aufgaben", failures);
        const slotsData = getValue(results[5], [] as TimeSlotRow[], "Terminslots", failures);
        const bookingsData = getValue(results[6], [] as BookingRow[], "Buchungen", failures);
        const txData = getValue(results[7], [] as TransactionRow[], "Transaktionen", failures);
        const convData = getValue(results[8], [] as ChatConversationRow[], "Chats", failures);
        const rolesData = getValue(results[9], [] as { user_id: string; role: string }[], "Admin-Rollen", failures);
        const confs = getValue(results[10], [] as { user_id: string; email_confirmed: boolean }[], "E-Mail-Bestätigungen", failures);

        setApplications(apps);
        setProfiles(profileData);
        setAdminUserIds(new Set(rolesData.map((r) => r.user_id)));
        setEmailConfirmedUserIds(new Set(confs.filter((c) => c.email_confirmed).map((c) => c.user_id)));

        // Risk-Flag-Sync: gruppieren statt N+1-Updates
        const toFlagTrue: string[] = [];
        const toFlagFalse: string[] = [];
        for (const kyc of kycData) {
          const profile = profileData.find((p) => p.user_id === kyc.user_id);
          const shouldFlag = profile ? checkRiskFlag(profile.living_since) : false;
          if (shouldFlag !== kyc.risk_flag) {
            (shouldFlag ? toFlagTrue : toFlagFalse).push(kyc.id);
            kyc.risk_flag = shouldFlag;
          }
        }
        if (toFlagTrue.length > 0 || toFlagFalse.length > 0) {
          await Promise.allSettled([
            toFlagTrue.length > 0
              ? supabase.from("kyc_verifications").update({ risk_flag: true }).in("id", toFlagTrue)
              : Promise.resolve(),
            toFlagFalse.length > 0
              ? supabase.from("kyc_verifications").update({ risk_flag: false }).in("id", toFlagFalse)
              : Promise.resolve(),
          ]);
        }

        setKycList(kycData);
        setTemplates(templatesData);
        setAssignments(assignData);
        setTimeSlots(slotsData);
        setAllBookings(bookingsData);
        setAllTransactions(txData);
        setChatConversations(convData);

        if (failures.length > 0) {
          toast({
            title: "Admin-Daten nur teilweise geladen",
            description: `Fehlende Bereiche: ${failures.join(", ")}`,
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("[AdminData] Unerwarteter Fehler beim Laden", error);
        toast({
          title: "Admin-Daten konnten nicht geladen werden",
          description: error instanceof Error ? error.message : "Unbekannter Fehler",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    })();
    inFlightRef.current = run;
    try { await run; } finally { inFlightRef.current = null; }
  }, [toast]);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  const getProfileForUser = useCallback((userId: string) => profiles.find((p) => p.user_id === userId), [profiles]);

  return (
    <AdminDataContext.Provider value={{
      applications, profiles, kycList, templates, assignments, timeSlots, allBookings, allTransactions, chatConversations,
      adminUserIds, emailConfirmedUserIds, loading, loadData, setProfiles, setKycList, setAllTransactions, getProfileForUser,
    }}>
      {children}
    </AdminDataContext.Provider>
  );
}
