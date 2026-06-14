import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/email-templates")({
  component: AdminEmailTemplatesPage,
});

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { Mail, Save, Send, Eye, AlertTriangle, CheckCircle2, Copy, Loader2 } from "lucide-react";

// Defaults für Reminder-Templates (gespiegelt zur Edge Function).
const REMINDER_DEFAULTS = {
  invite: {
    subject: "Erinnerung: Registrierung bei {{tenant_name}} abschließen",
    body: `Hallo {{first_name}},\n\ndeine Bewerbung bei {{tenant_name}} wurde bereits angenommen, aber du hast deinen Account noch nicht angelegt. Bitte schließe die Registrierung ab, damit es weitergehen kann.\n\n{{cta:Jetzt registrieren|{{portal_link}}}}\n\nOder kopiere diesen Link: {{portal_link}}`,
  },
  confirm: {
    subject: "Bitte bestätige deine E-Mail – {{tenant_name}}",
    body: `Wir haben deine Bestätigung für {{email}} noch nicht erhalten. Bitte bestätige deine E-Mail, damit du dich anmelden kannst.\n\n{{cta:E-Mail bestätigen|{{confirmation_link}}}}\n\nOder kopiere diesen Link: {{confirmation_link}}`,
  },
  completion: {
    subject: "Bitte schließe deine Registrierung ab – {{tenant_name}}",
    body: `Hallo {{first_name}},\n\nin deinem Account bei {{tenant_name}} fehlen noch ein paar Angaben (z.B. Personalausweis, Arbeitsvertrag oder Pflichtdaten). Bitte melde dich an und vervollständige dein Profil.\n\n{{cta:Jetzt vervollständigen|{{login_link}}}}\n\nLogin: {{login_link}}`,
  },
  no_booking: {
    subject: "Neue Aufträge warten auf dich – {{tenant_name}}",
    body: `Hallo {{first_name}},\n\ndu hast seit über 7 Tagen keine Aufträge mehr bei {{tenant_name}} gebucht. Im Portal warten freie Termine — sichere dir jetzt deinen nächsten Einsatz.\n\n{{cta:Aufträge ansehen|{{booking_link}}}}\n\nOder kopiere diesen Link: {{booking_link}}`,
  },
  recovery_mitarbeiter: {
    subject: "Wir sind umgezogen – dein neuer Portal-Link für {{tenant_name}}",
    body: `Hallo {{first_name}},\n\nwir haben eine neue Online-Adresse! Dein Mitarbeiter-Portal von {{tenant_name}} findest du ab sofort unter einer neuen URL.\n\nDeine Zugangsdaten bleiben unverändert – einfach mit der neuen Adresse einloggen, weitermachen mit Aufträgen, Onboarding-Schritten und Vertragsunterlagen wie gewohnt.\n\n{{cta:Zum neuen Portal|{{portal_link}}}}\n\nFalls der Button nicht funktioniert, kopiere diesen Link:\n{{portal_link}}\n\nViele Grüße\nDein {{tenant_name}}-Team`,
  },
  recovery_bewerber: {
    subject: "Wir sind umgezogen – schließe deine Registrierung bei {{tenant_name}} ab",
    body: `Hallo {{first_name}},\n\nschön, dass du dabei bist! Unser Portal hat eine neue Adresse – bitte schließe deine Registrierung bei {{tenant_name}} ab sofort über den folgenden Link ab:\n\n{{cta:Jetzt registrieren|{{portal_link}}}}\n\nFalls der Button nicht funktioniert, kopiere diesen Link:\n{{portal_link}}\n\nWir freuen uns auf dich!\nDein {{tenant_name}}-Team`,
  },
  appointment_30min: {
    subject: "Erinnerung: Dein Termin in 30 Minuten",
    body: `Hallo {{first_name}},\n\nkurze Erinnerung: dein Termin startet in 30 Minuten ({{appointment_time}} Uhr am {{appointment_date}}).\n\nBitte sei rechtzeitig bereit.\n\n{{cta:Zum Portal|{{portal_link}}}}\n\nViele Grüße\n{{tenant_name}}`,
  },

};

interface TenantEmail {
  id: string;
  name: string;
  domain: string;
  primary_color: string | null;
  logo_url: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to_email: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_password: string | null;
  welcome_email_subject: string | null;
  welcome_email_body: string | null;
  reset_email_subject: string | null;
  reset_email_body: string | null;
  email_signature: string | null;
  team_leader_name: string;
  company_email?: string | null;
  reminder_invite_subject: string | null;
  reminder_invite_body: string | null;
  reminder_confirm_subject: string | null;
  reminder_confirm_body: string | null;
  reminder_completion_subject: string | null;
  reminder_completion_body: string | null;
  reminder_no_booking_subject: string | null;
  reminder_no_booking_body: string | null;
  reminder_recovery_subject: string | null;
  reminder_recovery_body: string | null;
  reminder_recovery_bewerber_subject: string | null;
  reminder_recovery_bewerber_body: string | null;
  reminder_appointment_subject: string | null;
  reminder_appointment_body: string | null;
}

const PLACEHOLDERS = [
  { key: "first_name", label: "Vorname", preview: "Max" },
  { key: "last_name", label: "Nachname", preview: "Mustermann" },
  { key: "email", label: "E-Mail", preview: "max@example.com" },
  { key: "company_name", label: "Firmenname", preview: "TeamPortal" },
  { key: "portal_link", label: "Portal-Link", preview: "https://portal.example.com/register?token=abc" },
  { key: "team_leader_name", label: "Teamleiter", preview: "Anna Schmidt" },
  { key: "tenant_name", label: "Tenant-Name", preview: "BCU Beratung" },
  { key: "support_email", label: "Support-E-Mail", preview: "support@example.com" },
  { key: "reset_link", label: "Reset-Link", preview: "https://portal.example.com/reset-password?token=xyz" },
  { key: "login_link", label: "Login-Link", preview: "https://portal.example.com/login" },
  { key: "confirmation_link", label: "Bestätigungs-Link", preview: "https://portal.example.com/auth/confirmed?token_hash=…" },
  { key: "booking_link", label: "Aufträge-Link", preview: "https://portal.example.com/appointments" },
];

function replacePlaceholders(text: string, tenant: TenantEmail): string {
  const map: Record<string, string> = {
    first_name: "Max",
    last_name: "Mustermann",
    email: "max@example.com",
    company_name: tenant.name,
    portal_link: `https://${tenant.domain}/register?token=demo123`,
    team_leader_name: tenant.team_leader_name,
    tenant_name: tenant.name,
    support_email: tenant.company_email || tenant.sender_email || "support@example.com",
    reset_link: `https://${tenant.domain}/reset-password?token=demo123`,
    login_link: `https://${tenant.domain}/login`,
    confirmation_link: `https://${tenant.domain}/auth/confirmed?token_hash=demo123`,
    booking_link: `https://${tenant.domain}/appointments`,
  };
  let result = text;
  for (const [key, value] of Object.entries(map)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
  }
  // CTA-Syntax: {{cta:Label|URL}} -> sichtbarer Button (in Vorschau)
  result = result.replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) => {
    const color = tenant.primary_color || "#0f172a";
    return `<table cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${color};border-radius:8px"><a href="${String(href).trim()}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${String(label).trim()}</a></td></tr></table>`;
  });
  return result;
}

function generateEmailHtml(
  subject: string,
  body: string,
  signature: string,
  tenant: TenantEmail
): string {
  const color = tenant.primary_color || "#000000";
  const resolvedBody = replacePlaceholders(body, tenant);
  const resolvedSignature = replacePlaceholders(signature, tenant);

  // Convert newlines to <br> and detect {{portal_link}}/{{reset_link}} for CTA button
  const bodyHtml = resolvedBody
    .replace(/\n/g, "<br>")
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      `<a href="$1" style="color:${color};text-decoration:underline;">$1</a>`
    );

  const logoHtml = tenant.logo_url
    ? `<div style="text-align:center;margin-bottom:24px;"><img src="${tenant.logo_url}" alt="${tenant.name}" style="max-height:48px;max-width:200px;" /></div>`
    : "";

  const sigHtml = resolvedSignature
    ? `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px;color:#9ca3af;font-size:13px;line-height:20px;">${resolvedSignature.replace(/\n/g, "<br>")}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
<div style="background:#ffffff;border-radius:12px;padding:32px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
${logoHtml}
<h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 20px;line-height:1.3;">
${replacePlaceholders(subject, tenant)}
</h1>
<div style="color:#374151;font-size:15px;line-height:26px;">
${bodyHtml}
</div>
${sigHtml}
</div>
<div style="text-align:center;margin-top:16px;color:#9ca3af;font-size:11px;">
© ${new Date().getFullYear()} ${tenant.name}
</div>
</div>
</body>
</html>`;
}

function PlaceholderChips({ onInsert }: { onInsert: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {PLACEHOLDERS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onInsert(`{{${p.key}}}`)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
          title={`${p.label} einfügen`}
        >
          <Copy className="h-3 w-3" />
          {`{{${p.key}}}`}
        </button>
      ))}
    </div>
  );
}

function TemplateEditor({
  label,
  subject,
  onSubjectChange,
  body,
  onBodyChange,
  signature,
  onSignatureChange,
  tenant,
}: {
  label: string;
  subject: string;
  onSubjectChange: (v: string) => void;
  body: string;
  onBodyChange: (v: string) => void;
  signature: string;
  onSignatureChange: (v: string) => void;
  tenant: TenantEmail;
}) {
  const [showPreview, setShowPreview] = useState(true);
  const previewHtml = useMemo(
    () => generateEmailHtml(subject, body, signature, tenant),
    [subject, body, signature, tenant]
  );

  const insertIntoBody = (placeholder: string) => {
    onBodyChange(body + placeholder);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Editor */}
      <div className="space-y-4">
        <div>
          <Label className="text-xs font-medium">Betreff</Label>
          <Input
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="E-Mail Betreff…"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs font-medium">Inhalt</Label>
          <Textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder="E-Mail Text…"
            className="mt-1 min-h-[200px] font-mono text-sm"
            rows={10}
          />
          <p className="text-[11px] text-muted-foreground mt-1">Platzhalter anklicken zum Einfügen:</p>
          <PlaceholderChips onInsert={insertIntoBody} />
        </div>
        <div>
          <Label className="text-xs font-medium">Signatur</Label>
          <Textarea
            value={signature}
            onChange={(e) => onSignatureChange(e.target.value)}
            placeholder="Herzliche Grüße,&#10;Dein {{company_name}}-Team"
            className="mt-1 min-h-[80px] text-sm"
            rows={3}
          />
        </div>
      </div>

      {/* Preview */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <Eye className="h-3.5 w-3.5" /> Vorschau
          </Label>
          <Badge variant="secondary" className="text-[10px]">Live-Vorschau</Badge>
        </div>
        <div className="border rounded-xl overflow-hidden bg-muted/30">
          <iframe
            srcDoc={previewHtml}
            className="w-full h-[500px] border-0"
            title="E-Mail Vorschau"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}

function AdminEmailTemplatesPage() {
  const [tenants, setTenants] = useState<TenantEmail[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  type TestTemplateKey = "welcome" | "reset" | "invite" | "confirm" | "completion" | "no_booking" | "recovery_ma" | "recovery_bew" | "appointment";
  const [testType, setTestType] = useState<TestTemplateKey>("welcome");
  const { toast } = useToast();

  // Template state
  const [welcomeSubject, setWelcomeSubject] = useState("");
  const [welcomeBody, setWelcomeBody] = useState("");
  const [resetSubject, setResetSubject] = useState("");
  const [resetBody, setResetBody] = useState("");
  const [signature, setSignature] = useState("");
  const [senderName, setSenderName] = useState("");
  const [replyTo, setReplyTo] = useState("");

  // Reminder-Templates
  const [rInviteSubject, setRInviteSubject] = useState("");
  const [rInviteBody, setRInviteBody] = useState("");
  const [rConfirmSubject, setRConfirmSubject] = useState("");
  const [rConfirmBody, setRConfirmBody] = useState("");
  const [rCompletionSubject, setRCompletionSubject] = useState("");
  const [rCompletionBody, setRCompletionBody] = useState("");
  const [rNoBookingSubject, setRNoBookingSubject] = useState("");
  const [rNoBookingBody, setRNoBookingBody] = useState("");
  const [rRecoveryMaSubject, setRRecoveryMaSubject] = useState("");
  const [rRecoveryMaBody, setRRecoveryMaBody] = useState("");
  const [rRecoveryBewSubject, setRRecoveryBewSubject] = useState("");
  const [rRecoveryBewBody, setRRecoveryBewBody] = useState("");
  const [rAppointmentSubject, setRAppointmentSubject] = useState("");
  const [rAppointmentBody, setRAppointmentBody] = useState("");

  const loadTenants = async () => {
    setLoading(true);
    const FULL_COLS = "id, name, domain, primary_color, logo_url, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, welcome_email_subject, welcome_email_body, reset_email_subject, reset_email_body, email_signature, team_leader_name, reminder_invite_subject, reminder_invite_body, reminder_confirm_subject, reminder_confirm_body, reminder_completion_subject, reminder_completion_body, reminder_no_booking_subject, reminder_no_booking_body, reminder_recovery_subject, reminder_recovery_body, reminder_recovery_bewerber_subject, reminder_recovery_bewerber_body, reminder_appointment_subject, reminder_appointment_body";
    // Fallback: ohne neue Reminder-Spalten (Migrationen 20260606200000 + 20260608120000), falls noch nicht angewandt.
    const FALLBACK_COLS = "id, name, domain, primary_color, logo_url, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, welcome_email_subject, welcome_email_body, reset_email_subject, reset_email_body, email_signature, team_leader_name, reminder_invite_subject, reminder_invite_body, reminder_confirm_subject, reminder_confirm_body, reminder_completion_subject, reminder_completion_body, reminder_no_booking_subject, reminder_no_booking_body, reminder_recovery_subject, reminder_recovery_body";

    let { data, error } = await (supabase as any).from("tenants").select(FULL_COLS).order("name");

    if (error) {
      console.warn("[email-templates] Full select fehlgeschlagen, Fallback wird versucht:", error.message);
      const retry = await (supabase as any).from("tenants").select(FALLBACK_COLS).order("name");
      data = retry.data;
      if (retry.error) {
        toast({
          title: "Tenants konnten nicht geladen werden",
          description: retry.error.message,
          variant: "destructive",
        });
        setTenants([]);
        setLoading(false);
        return;
      }
      toast({
        title: "Einige neue Template-Felder fehlen",
        description: "Bitte Migrationen anwenden: 20260606200000_recovery_template_split.sql und 20260608120000_appointment_reminder.sql",
        variant: "destructive",
      });
    }

    const rows = (data as TenantEmail[] | null) ?? [];
    setTenants(rows);
    if (rows.length > 0 && !selectedTenantId) {
      setSelectedTenantId(rows[0].id);
      loadTenantData(rows[0]);
    }
    setLoading(false);
  };

  const loadTenantData = (t: TenantEmail) => {
    setWelcomeSubject(t.welcome_email_subject || "Willkommen im Team!");
    setWelcomeBody(
      t.welcome_email_body ||
        "Hallo {{first_name}},\n\nherzlich willkommen! Deine Bewerbung wurde angenommen.\n\nBitte registriere dich über folgenden Link:\n{{portal_link}}\n\nBei Fragen steht dir {{team_leader_name}} zur Verfügung.\n\nViele Grüße,\n{{company_name}}"
    );
    setResetSubject(t.reset_email_subject || "Passwort zurücksetzen");
    setResetBody(
      t.reset_email_body ||
        "Hallo {{first_name}},\n\ndu hast eine Anfrage zum Zurücksetzen deines Passworts gestellt.\n\nKlicke auf den folgenden Link, um dein Passwort zurückzusetzen:\n{{reset_link}}\n\nFalls du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail.\n\nViele Grüße,\n{{company_name}}"
    );
    setSignature(t.email_signature || "");
    setSenderName(t.sender_name || "");
    setReplyTo(t.reply_to_email || "");
    setRInviteSubject(t.reminder_invite_subject || REMINDER_DEFAULTS.invite.subject);
    setRInviteBody(t.reminder_invite_body || REMINDER_DEFAULTS.invite.body);
    setRConfirmSubject(t.reminder_confirm_subject || REMINDER_DEFAULTS.confirm.subject);
    setRConfirmBody(t.reminder_confirm_body || REMINDER_DEFAULTS.confirm.body);
    setRCompletionSubject(t.reminder_completion_subject || REMINDER_DEFAULTS.completion.subject);
    setRCompletionBody(t.reminder_completion_body || REMINDER_DEFAULTS.completion.body);
    setRNoBookingSubject(t.reminder_no_booking_subject || REMINDER_DEFAULTS.no_booking.subject);
    setRNoBookingBody(t.reminder_no_booking_body || REMINDER_DEFAULTS.no_booking.body);
    setRRecoveryMaSubject(t.reminder_recovery_subject || REMINDER_DEFAULTS.recovery_mitarbeiter.subject);
    setRRecoveryMaBody(t.reminder_recovery_body || REMINDER_DEFAULTS.recovery_mitarbeiter.body);
    setRRecoveryBewSubject(t.reminder_recovery_bewerber_subject || REMINDER_DEFAULTS.recovery_bewerber.subject);
    setRRecoveryBewBody(t.reminder_recovery_bewerber_body || REMINDER_DEFAULTS.recovery_bewerber.body);
    setRAppointmentSubject(t.reminder_appointment_subject || REMINDER_DEFAULTS.appointment_30min.subject);
    setRAppointmentBody(t.reminder_appointment_body || REMINDER_DEFAULTS.appointment_30min.body);
  };

  useEffect(() => {
    loadTenants();
  }, []);

  useEffect(() => {
    const t = tenants.find((t) => t.id === selectedTenantId);
    if (t) loadTenantData(t);
  }, [selectedTenantId]);

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId);
  const smtpConfigured = !!(
    selectedTenant?.smtp_host &&
    selectedTenant?.smtp_username &&
    selectedTenant?.smtp_password &&
    selectedTenant?.sender_email
  );

  const handleSave = async () => {
    if (!selectedTenantId) return;
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        welcome_email_subject: welcomeSubject,
        welcome_email_body: welcomeBody,
        reset_email_subject: resetSubject,
        reset_email_body: resetBody,
        email_signature: signature,
        sender_name: senderName || null,
        reply_to_email: replyTo || null,
        reminder_invite_subject: rInviteSubject,
        reminder_invite_body: rInviteBody,
        reminder_confirm_subject: rConfirmSubject,
        reminder_confirm_body: rConfirmBody,
        reminder_completion_subject: rCompletionSubject,
        reminder_completion_body: rCompletionBody,
        reminder_no_booking_subject: rNoBookingSubject,
        reminder_no_booking_body: rNoBookingBody,
        reminder_recovery_subject: rRecoveryMaSubject,
        reminder_recovery_body: rRecoveryMaBody,
        reminder_recovery_bewerber_subject: rRecoveryBewSubject,
        reminder_recovery_bewerber_body: rRecoveryBewBody,
        reminder_appointment_subject: rAppointmentSubject,
        reminder_appointment_body: rAppointmentBody,
      } as any)
      .eq("id", selectedTenantId);
    setSaving(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Templates gespeichert" });
      loadTenants();
    }
  };

  const getTestTemplate = (key: TestTemplateKey): { subject: string; body: string } => {
    switch (key) {
      case "welcome": return { subject: welcomeSubject, body: welcomeBody };
      case "reset": return { subject: resetSubject, body: resetBody };
      case "invite": return { subject: rInviteSubject, body: rInviteBody };
      case "confirm": return { subject: rConfirmSubject, body: rConfirmBody };
      case "completion": return { subject: rCompletionSubject, body: rCompletionBody };
      case "no_booking": return { subject: rNoBookingSubject, body: rNoBookingBody };
      case "recovery_ma": return { subject: rRecoveryMaSubject, body: rRecoveryMaBody };
      case "recovery_bew": return { subject: rRecoveryBewSubject, body: rRecoveryBewBody };
      case "appointment": return { subject: rAppointmentSubject, body: rAppointmentBody };
    }
  };

  const handleUseMyEmail = async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) setTestEmail(data.user.email);
    else toast({ title: "Keine E-Mail gefunden", variant: "destructive" });
  };

  const handleTestSend = async () => {
    if (!testEmail || !selectedTenant) return;
    setTesting(true);
    try {
      const { subject, body } = getTestTemplate(testType);
      const html = generateEmailHtml(subject, body, signature, selectedTenant);

      const { data, error } = await supabase.functions.invoke("send-invitation-email", {
        body: {
          to: testEmail,
          fullName: "Test Benutzer",
          firstName: "Test",
          lastName: "Benutzer",
          registrationLink: `https://${selectedTenant.domain}/register?token=test`,
          tenantId: selectedTenantId,
          isTestEmail: true,
          customSubject: `[TEST] ${replacePlaceholders(subject, selectedTenant)}`,
          customHtml: html,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: "Test-E-Mail gesendet", description: `An ${testEmail}` });
    } catch (err: any) {
      toast({ title: "Fehler beim Versand", description: err.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-5">
        <PageHeaderSkeleton />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">E-Mail Templates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            E-Mail-Vorlagen pro Tenant verwalten und testen
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
            <SelectTrigger className="w-56 h-9 text-xs">
              <SelectValue placeholder="Tenant wählen…" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleSave} disabled={saving || !selectedTenantId} size="sm" className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Speichern
          </Button>
        </div>
      </div>

      {/* SMTP Warning */}
      {selectedTenant && !smtpConfigured && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>SMTP nicht konfiguriert</strong> – E-Mail-Versand ist für diesen Tenant nicht möglich.
            Bitte zuerst unter <em>Domains</em> die SMTP-Einstellungen hinterlegen.
          </span>
        </div>
      )}

      {selectedTenant && smtpConfigured && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            SMTP aktiv: <strong>{selectedTenant.smtp_host}</strong> · Absender:{" "}
            <strong>{selectedTenant.sender_email}</strong>
          </span>
        </div>
      )}

      {/* Sender Settings */}
      {selectedTenant && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium">Absender-Einstellungen</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-5">
            <div>
              <Label className="text-xs">Absendername</Label>
              <Input
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder={selectedTenant.name}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Reply-To</Label>
              <Input
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder={selectedTenant.sender_email || "reply@example.com"}
                className="mt-1"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Template Tabs */}
      {selectedTenant && (
        <Tabs defaultValue="welcome" className="space-y-4">
          <TabsList>
            <TabsTrigger value="welcome" className="text-xs gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Willkommen / Einladung
            </TabsTrigger>
            <TabsTrigger value="reset" className="text-xs gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Passwort zurücksetzen
            </TabsTrigger>
            <TabsTrigger value="reminders" className="text-xs gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Erinnerungen
            </TabsTrigger>
          </TabsList>

          <TabsContent value="welcome">
            <TemplateEditor
              label="Willkommensmail"
              subject={welcomeSubject}
              onSubjectChange={setWelcomeSubject}
              body={welcomeBody}
              onBodyChange={setWelcomeBody}
              signature={signature}
              onSignatureChange={setSignature}
              tenant={selectedTenant}
            />
          </TabsContent>

          <TabsContent value="reset">
            <TemplateEditor
              label="Passwort zurücksetzen"
              subject={resetSubject}
              onSubjectChange={setResetSubject}
              body={resetBody}
              onBodyChange={setResetBody}
              signature={signature}
              onSignatureChange={setSignature}
              tenant={selectedTenant}
            />
          </TabsContent>

          <TabsContent value="reminders">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 mb-3 text-[12px] text-muted-foreground">
              Diese Mails verschickt das System automatisch (max. 5×, mindestens 3 Tage Abstand).
              Verwende <code>{`{{cta:Label|{{portal_link}}}}`}</code> für einen Button.
              Plain-Text wird automatisch in HTML umgewandelt.
            </div>
            <Tabs defaultValue="invite" className="space-y-3">
              <TabsList>
                <TabsTrigger value="invite" className="text-xs">Bewerber: Einladung</TabsTrigger>
                <TabsTrigger value="confirm" className="text-xs">E-Mail bestätigen</TabsTrigger>
                <TabsTrigger value="completion" className="text-xs">Registrierung abschließen</TabsTrigger>
                <TabsTrigger value="no_booking" className="text-xs">Keine Buchung (7 Tage)</TabsTrigger>
                <TabsTrigger value="recovery" className="text-xs">Domain-Wechsel</TabsTrigger>
                <TabsTrigger value="appointment" className="text-xs">30 Min vor Termin</TabsTrigger>
              </TabsList>
              <TabsContent value="invite">
                <TemplateEditor
                  label="Einladungs-Erinnerung"
                  subject={rInviteSubject} onSubjectChange={setRInviteSubject}
                  body={rInviteBody} onBodyChange={setRInviteBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="confirm">
                <TemplateEditor
                  label="E-Mail-Bestätigungs-Erinnerung"
                  subject={rConfirmSubject} onSubjectChange={setRConfirmSubject}
                  body={rConfirmBody} onBodyChange={setRConfirmBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="completion">
                <TemplateEditor
                  label="Registrierung-Abschließen-Erinnerung"
                  subject={rCompletionSubject} onSubjectChange={setRCompletionSubject}
                  body={rCompletionBody} onBodyChange={setRCompletionBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="no_booking">
                <TemplateEditor
                  label="Keine-Buchung-Erinnerung"
                  subject={rNoBookingSubject} onSubjectChange={setRNoBookingSubject}
                  body={rNoBookingBody} onBodyChange={setRNoBookingBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="recovery">
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 mb-3 text-[11px] text-amber-900 dark:text-amber-200">
                  Einmaliger Versand pro Mitarbeiter, wenn du im Admin die <strong>primäre Portal-Domain</strong> wechselst. Bewerber laufen über die normale Einladungs-Erinnerung mit der aktuellen Portal-URL — kein eigenes Template nötig.
                </div>
                <TemplateEditor
                  label="Domain-Wechsel – Mitarbeiter"
                  subject={rRecoveryMaSubject} onSubjectChange={setRRecoveryMaSubject}
                  body={rRecoveryMaBody} onBodyChange={setRRecoveryMaBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
              <TabsContent value="appointment">
                <div className="rounded-md border border-sky-300 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-700 px-3 py-2 mb-3 text-[11px] text-sky-900 dark:text-sky-200">
                  Wird automatisch <strong>30 Minuten vor dem gebuchten Termin</strong> an den Mitarbeiter gesendet (Cron alle 10 Min, Toleranzfenster 25–40 Min). Pro Buchung max. 1 Reminder. Platzhalter: <code>{"{{appointment_date}}"}</code>, <code>{"{{appointment_time}}"}</code>.
                </div>
                <TemplateEditor
                  label="30-Min-Termin-Reminder"
                  subject={rAppointmentSubject} onSubjectChange={setRAppointmentSubject}
                  body={rAppointmentBody} onBodyChange={setRAppointmentBody}
                  signature={signature} onSignatureChange={setSignature}
                  tenant={selectedTenant}
                />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      )}

      {/* Test Send */}
      {selectedTenant && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Send className="h-4 w-4" /> Test-E-Mail senden
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-5">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs">Empfänger-E-Mail</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="test@example.com"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleUseMyEmail}>
                    An mich
                  </Button>
                </div>
              </div>
              <div className="w-60">
                <Label className="text-xs">Template</Label>
                <Select value={testType} onValueChange={(v) => setTestType(v as TestTemplateKey)}>
                  <SelectTrigger className="mt-1 h-10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="welcome">Willkommen / Einladung</SelectItem>
                    <SelectItem value="reset">Passwort-Reset</SelectItem>
                    <SelectItem value="invite">Erinnerung: Einladung</SelectItem>
                    <SelectItem value="confirm">Erinnerung: E-Mail bestätigen</SelectItem>
                    <SelectItem value="completion">Erinnerung: Registrierung abschließen</SelectItem>
                    <SelectItem value="no_booking">Erinnerung: Keine Buchung</SelectItem>
                    <SelectItem value="recovery_ma">Domain-Wechsel: Mitarbeiter</SelectItem>
                    <SelectItem value="recovery_bew">Domain-Wechsel: Bewerber</SelectItem>
                    <SelectItem value="appointment">30 Min vor Termin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleTestSend}
                disabled={testing || !testEmail || !smtpConfigured}
                className="gap-1.5"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Senden
              </Button>
            </div>
            {!smtpConfigured && (
              <p className="text-xs text-destructive mt-2">
                Testversand nicht möglich – SMTP ist nicht konfiguriert.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
