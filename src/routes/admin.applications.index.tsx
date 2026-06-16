import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/applications/")({
  component: AdminApplicationsPage,
});

import { useState, useEffect } from "react";
import { useNavigate } from "@/lib/router-compat";
import { useAdminData } from "@/contexts/AdminDataContext";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/EmptyState";
import { FileText, Download, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { exportToCsv } from "@/lib/csv-export";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { ImportApplicationsDialog } from "@/components/ImportApplicationsDialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useServerFn } from "@tanstack/react-start";
import { resendInvitesToUnregistered, getInviteResendQueueStatus, listInviteResendQueueItems, skipQueuedInvitesFor, stopInviteResendQueue } from "@/lib/resend-invites.functions";
import { MailPlus, Eye } from "lucide-react";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationBar } from "@/components/PaginationBar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

function AdminApplicationsPage() {
  const { applications, loading, loadData } = useAdminData();
  const [tenantMap, setTenantMap] = useState<Record<string, { name: string; domain: string; primary_domain: string | null }>>({});
  const navigate = useNavigate();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showTest, setShowTest] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [resendInvitesLoading, setResendInvitesLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [dripOpen, setDripOpen] = useState(false);
  const [windowHours, setWindowHours] = useState(24);
  const [preview, setPreview] = useState<{
    eligible: number; wouldQueue?: number; alreadyQueued: number;
    items: Array<{ id: string; email: string; full_name: string | null; first_name: string | null; last_name: string | null; phone: string | null; tenant_id: string; status: string; created_at: string }>;
    perTenant: Record<string, number>;
    stats?: { acceptedTotal: number; missingEmailOrTenant: number; alreadyRegistered: number; duplicateEmail: number };
  } | null>(null);
  const [previewSelected, setPreviewSelected] = useState<Set<string>>(new Set());
  const [rejectingPreview, setRejectingPreview] = useState(false);
  const [queueStatus, setQueueStatus] = useState<{
    counts: { queued: number; sent: number; failed: number; skipped: number };
    nextScheduledAt: string | null; lastScheduledAt: string | null;
  } | null>(null);
  const resendInvitesFn = useServerFn(resendInvitesToUnregistered);
  const skipQueuedFn = useServerFn(skipQueuedInvitesFor);
  const stopQueueFn = useServerFn(stopInviteResendQueue);
  const [stopping, setStopping] = useState(false);
  const handleStopQueue = async () => {
    const pending = queueStatus?.counts.queued ?? 0;
    if (pending === 0) return;
    if (!window.confirm(`Wirklich die komplette Drip-Queue stoppen?\n\n${pending} ausstehende Einladungs-Mails werden auf "übersprungen" gesetzt und NICHT mehr versendet. Bereits gesendete Mails bleiben unverändert.`)) return;
    setStopping(true);
    try {
      const r = await stopQueueFn({ data: { reason: "admin_stop_all" } });
      toast({ title: "Drip-Queue gestoppt", description: `${r.stopped} ausstehende Mails wurden übersprungen.` });
      await loadQueueStatus();
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? "Konnte Queue nicht stoppen", variant: "destructive" });
    } finally {
      setStopping(false);
    }
  };

  const queueStatusFn = useServerFn(getInviteResendQueueStatus);
  const queueListFn = useServerFn(listInviteResendQueueItems);
  const [queueDetailsOpen, setQueueDetailsOpen] = useState(false);
  const [queueTab, setQueueTab] = useState<"queued" | "sent" | "failed" | "skipped">("queued");
  const [queueItems, setQueueItems] = useState<Array<any>>([]);
  const [queueItemsLoading, setQueueItemsLoading] = useState(false);
  const openQueueDetails = async (tab: "queued" | "sent" | "failed" | "skipped" = "queued") => {
    setQueueTab(tab); setQueueDetailsOpen(true); setQueueItemsLoading(true);
    try { const r = await queueListFn({ data: { status: tab } }); setQueueItems(r.items); }
    catch (e: any) { toast({ title: "Fehler", description: e?.message ?? "Konnte Queue nicht laden", variant: "destructive" }); }
    finally { setQueueItemsLoading(false); }
  };
  useEffect(() => {
    if (!queueDetailsOpen) return;
    setQueueItemsLoading(true);
    queueListFn({ data: { status: queueTab } })
      .then(r => setQueueItems(r.items))
      .catch(() => {})
      .finally(() => setQueueItemsLoading(false));
  }, [queueTab, queueDetailsOpen]);

  const loadQueueStatus = async () => {
    try { setQueueStatus(await queueStatusFn({ data: undefined as any })); } catch { /* silent */ }
  };
  useEffect(() => { loadQueueStatus(); const t = setInterval(loadQueueStatus, 30_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    supabase.from("tenants").select("id, name, domain, primary_domain").then(({ data }) => {
      const map: Record<string, { name: string; domain: string; primary_domain: string | null }> = {};
      (data ?? []).forEach((t: any) => { map[t.id] = { name: t.name, domain: t.domain, primary_domain: t.primary_domain ?? null }; });
      setTenantMap(map);
    });
  }, []);

  const buildPortalLink = (tenantId?: string | null) => {
    const tenant = tenantId ? tenantMap[tenantId] : null;
    const activeDomain = tenant?.primary_domain ?? tenant?.domain ?? null;
    return activeDomain
      ? `https://portal.${activeDomain}/register`
      : `${window.location.origin}/register`;
  };

  const sendInvitationEmail = async (app: (typeof applications)[number]) => {
    if (!app.email) throw new Error("Keine E-Mail-Adresse hinterlegt");
    if (!app.tenant_id) throw new Error("Kein Tenant hinterlegt");

    const { data, error } = await supabase.functions.invoke("send-invitation-email", {
      body: {
        to: app.email,
        fullName: app.full_name,
        firstName: app.first_name,
        lastName: app.last_name,
        registrationLink: buildPortalLink(app.tenant_id),
        tenantId: app.tenant_id,
      },
    });

    if (error) throw new Error(error.message || "E-Mail-Versand fehlgeschlagen");
    if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);

    // Doppelversand verhindern: offene Drip-Queue-Einträge dieses Bewerbers überspringen.
    try {
      await skipQueuedFn({ data: { application_ids: [app.id], emails: app.email ? [app.email] : [], reason: "manual_resend" } });
    } catch { /* nicht kritisch – Hauptmail wurde gesendet */ }
  };

  const sendInvitationEmailsInBatches = async (appsToInvite: Array<(typeof applications)[number]>) => {
    const failures: Array<{ app: (typeof applications)[number]; reason: string }> = [];
    let sent = 0;

    for (let i = 0; i < appsToInvite.length; i += 5) {
      const batch = appsToInvite.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map((app) => sendInvitationEmail(app)));

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          sent += 1;
          return;
        }
        failures.push({
          app: batch[index],
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      });
    }

    return { sent, failures };
  };

  const loadPreview = async () => {
    setPreviewLoading(true);
    try {
      const r = await resendInvitesFn({ data: { windowHours, dryRun: true } });
      setPreview({
        eligible: r.eligible,
        wouldQueue: (r as any).wouldQueue ?? 0,
        alreadyQueued: (r as any).alreadyQueued ?? 0,
        items: (r as any).items ?? [],
        perTenant: (r as any).perTenant ?? {},
        stats: (r as any).stats,
      });
    } catch (err: any) {
      toast({ title: "Vorschau fehlgeschlagen", description: err.message, variant: "destructive" });
      setDripOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const openDripDialog = async () => {
    setDripOpen(true);
    setPreview(null);
    setPreviewSelected(new Set());
    await loadPreview();
  };

  const previewTotalReminders = (preview?.wouldQueue ?? 0) + (preview?.alreadyQueued ?? 0);
  const previewWouldQueue = preview?.wouldQueue ?? 0;
  const previewAlreadyQueued = preview?.alreadyQueued ?? 0;
  const previewEligible = preview?.eligible ?? 0;

  const rejectPreviewSelected = async () => {
    if (previewSelected.size === 0) return;
    setRejectingPreview(true);
    try {
      const ids = Array.from(previewSelected);
      const { error } = await supabase.from("applications").update({ status: "abgelehnt" }).in("id", ids);
      if (error) throw error;
      toast({ title: "Aus Drip ausgeschlossen", description: `${ids.length} Bewerber auf "abgelehnt" gesetzt.` });
      setPreviewSelected(new Set());
      await loadData();
      await loadPreview();
    } catch (err: any) {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    } finally {
      setRejectingPreview(false);
    }
  };


  const confirmDripSend = async () => {
    setResendInvitesLoading(true);
    try {
      const r = await resendInvitesFn({ data: { windowHours, dryRun: false } });
      toast({
        title: "Einladungs-Queue erstellt",
        description: `${r.queued} von ${r.eligible} Bewerbern eingeplant · Verteilung über ${r.windowHours}h. Versand alle 15 min per Cron.`,
      });
      setDripOpen(false);
      loadQueueStatus();
    } catch (err: any) {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    } finally {
      setResendInvitesLoading(false);
    }
  };

  const acceptApplication = async (app: typeof applications[0], e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(app.id);
    try {
      const { error: updateError } = await supabase.from("applications").update({ status: "akzeptiert" }).eq("id", app.id);
      if (updateError) throw updateError;

      // Send invitation email
      const { error: emailError } = await supabase.functions.invoke("send-invitation-email", {
        body: {
          to: app.email, fullName: app.full_name, firstName: app.first_name,
          lastName: app.last_name, registrationLink: buildPortalLink(app.tenant_id), tenantId: app.tenant_id,
        },
      });

      // Offene Drip-Queue-Einträge dieses Bewerbers überspringen (Doppelversand vermeiden).
      if (!emailError) {
        try {
          await skipQueuedFn({ data: { application_ids: [app.id], emails: app.email ? [app.email] : [], reason: "accepted_manual" } });
        } catch { /* nicht kritisch */ }
      }


      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("activity_log").insert({
          action: "bewerbung_akzeptiert", entity_type: "application", entity_id: app.id,
          actor_id: user.id, comment: `Bewerbung von ${app.full_name} akzeptiert.`,
          old_status: app.status, new_status: "akzeptiert",
        });
      }

      toast({
        title: emailError ? "Akzeptiert – E-Mail fehlgeschlagen" : "Bewerbung akzeptiert",
        description: emailError ? "Portal-Link konnte nicht gesendet werden." : "Willkommensmail wurde gesendet.",
        variant: emailError ? "destructive" : "default",
      });
      loadData();
    } catch (err: any) {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const rejectApplication = async (app: typeof applications[0], e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(app.id);
    try {
      const { error } = await supabase.from("applications").update({ status: "abgelehnt" }).eq("id", app.id);
      if (error) throw error;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("activity_log").insert({
          action: "bewerbung_abgelehnt", entity_type: "application", entity_id: app.id,
          actor_id: user.id, comment: `Bewerbung von ${app.full_name} abgelehnt.`,
          old_status: app.status, new_status: "abgelehnt",
        });
      }
      toast({ title: "Bewerbung abgelehnt" });
      loadData();
    } catch (err: any) {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const deleteApplication = async (id: string, name: string) => {
    setDeleting(id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("activity_log").insert({
          action: "bewerbung_geloescht", entity_type: "application", entity_id: id,
          actor_id: user.id, comment: `Bewerbung von ${name} gelöscht.`,
        });
      }
      const { error } = await supabase.from("applications").delete().eq("id", id);
      if (error) throw error;
      toast({ title: "Bewerbung gelöscht" });
      loadData();
    } catch (err: any) {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  };

  // ─── Bulk-Aktionen ───
  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleSelectAllPage = (ids: string[], allSelected: boolean) => {
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  };
  const bulkUpdate = async (newStatus: "akzeptiert" | "abgelehnt") => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selected);
      const selectedApplications = applications.filter((app) => selected.has(app.id));
      const { error } = await supabase.from("applications").update({ status: newStatus }).in("id", ids);
      if (error) throw error;

      if (newStatus === "akzeptiert") {
        const appsToInvite = selectedApplications.filter((app) => app.status !== "akzeptiert");
        const { sent, failures } = await sendInvitationEmailsInBatches(appsToInvite);

        toast({
          title: failures.length > 0
            ? `${ids.length} Bewerbungen angenommen · ${failures.length} Mail(s) fehlgeschlagen`
            : `${ids.length} Bewerbungen angenommen`,
          description: failures.length > 0
            ? failures.slice(0, 2).map(({ app, reason }) => `${app.full_name}: ${reason}`).join(" · ")
            : `${sent} Einladungen wurden gesendet und im E-Mail-Center protokolliert.`,
          variant: failures.length > 0 ? "destructive" : "default",
        });
      } else {
        toast({ title: `${ids.length} Bewerbungen abgelehnt` });
      }

      setSelected(new Set());
      loadData();
    } catch (err: any) {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  };
  const bulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from("applications").delete().in("id", ids);
      if (error) throw error;
      toast({ title: `${ids.length} Bewerbungen gelöscht` });
      setSelected(new Set());
      loadData();
    } catch (err: any) {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  };

  const filtered = applications.filter((a: any) => {
    if (!showTest && a.is_test === true) return false;
    return (
      (a.full_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (a.email ?? "").toLowerCase().includes(search.toLowerCase())
    );
  });
  const testCount = applications.filter((a: any) => a.is_test === true).length;

  const { paged, page, setPage, pageCount, rangeFrom, rangeTo, total } = usePagination(filtered, 25);

  if (loading) return <div className="p-6 lg:p-8 space-y-5"><PageHeaderSkeleton /><TableSkeleton rows={5} cols={5} /></div>;


  const statusColor = (status: string) => {
    if (status === "akzeptiert") return "bg-status-success text-status-success-foreground";
    if (status === "abgelehnt")  return "bg-destructive text-destructive-foreground";
    return "bg-status-info text-status-info-foreground";
  };

  const statusLabel = (status: string) => {
    if (status === "akzeptiert") return "Akzeptiert";
    if (status === "abgelehnt") return "Abgelehnt";
    if (status === "neu" || status === "eingegangen") return "Neu";
    return status;
  };

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">Bewerbungen</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{applications.length} Einträge</p>
        </div>
        <div className="flex gap-2 items-center">
          <Input placeholder="Suchen…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs h-9 text-sm" />
          {testCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer whitespace-nowrap" title="Test-Bewerbungen aus der Landing-Page-Vorschau">
              <input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} className="h-3.5 w-3.5" />
              Test ({testCount})
            </label>
          )}
          <ImportApplicationsDialog onImported={loadData} />
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs gap-1.5"
            disabled={resendInvitesLoading || previewLoading}
            onClick={openDripDialog}
            title="Vorschau anzeigen, bevor Einladungs-Mails an alle akzeptierten Bewerber ohne Account verteilt (Drip) versendet werden."
          >
            {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailPlus className="h-3.5 w-3.5" />}
            Drip-Einladungen planen
          </Button>
          <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5" onClick={() => exportToCsv("bewerbungen.csv", filtered, [
            { key: "full_name", label: "Name" }, { key: "email", label: "E-Mail" }, { key: "phone", label: "Telefon" },
            { key: "status", label: "Status" }, { key: "created_at", label: "Datum" },
          ])}><Download className="h-3.5 w-3.5" /> CSV</Button>
        </div>
      </div>

      {queueStatus && (queueStatus.counts.queued + queueStatus.counts.sent + queueStatus.counts.failed > 0) && (
        <div className="flex items-center gap-4 rounded-xl border bg-card px-4 py-2.5 text-xs">
          <span className="font-medium text-muted-foreground">Drip-Queue:</span>
          <button type="button" className="hover:underline" onClick={() => openQueueDetails("queued")}>
            <span className="font-semibold text-foreground">{queueStatus.counts.queued}</span> ausstehend
          </button>
          <button type="button" className="text-status-success hover:underline" onClick={() => openQueueDetails("sent")}>
            <span className="font-semibold">{queueStatus.counts.sent}</span> gesendet
          </button>
          {queueStatus.counts.failed > 0 && (
            <button type="button" className="text-destructive hover:underline" onClick={() => openQueueDetails("failed")}>
              <span className="font-semibold">{queueStatus.counts.failed}</span> fehlgeschlagen
            </button>
          )}
          {queueStatus.counts.skipped > 0 && (
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => openQueueDetails("skipped")}>
              {queueStatus.counts.skipped} übersprungen
            </button>
          )}
          {queueStatus.counts.queued > 0 && (() => {
            const RATE = 40; // Mails/h (process-invite-resend-queue: 4 Runs × 10)
            const ACTIVE_START = 5, ACTIVE_END = 23;
            let remaining = queueStatus.counts.queued;
            const now = new Date();
            const cursor = new Date(now);
            while (remaining > 0) {
              const h = parseInt(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(cursor), 10);
              if (h < ACTIVE_START || h >= ACTIVE_END) {
                // springe zum nächsten 05:00 Berlin
                cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
                continue;
              }
              const canThisHour = Math.min(remaining, RATE);
              remaining -= canThisHour;
              cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
            }
            return (
              <span className="text-muted-foreground ml-auto">
                ~{RATE}/Std · fertig ca. {cursor.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            );
          })()}
          {queueStatus.nextScheduledAt && queueStatus.counts.queued === 0 && (
            <span className="text-muted-foreground ml-auto">
              Nächster Versand: {new Date(queueStatus.nextScheduledAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs ml-2" onClick={() => openQueueDetails("queued")}>Details</Button>
          {queueStatus.counts.queued > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs"
              disabled={stopping}
              onClick={handleStopQueue}
              title="Setzt alle noch ausstehenden Drip-Mails auf 'übersprungen'. Bereits gesendete Mails bleiben unverändert."
            >
              {stopping ? "Stoppe…" : "Queue stoppen"}
            </Button>
          )}

        </div>
      )}


      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <p className="text-sm text-foreground">
            <strong>{selected.size}</strong> ausgewählt
          </p>
          <div className="flex gap-2">
            <Button size="sm" className="h-8 text-xs gap-1 bg-accent text-accent-foreground hover:bg-accent/90" disabled={bulkLoading} onClick={() => bulkUpdate("akzeptiert")}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Annehmen
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground" disabled={bulkLoading} onClick={() => bulkUpdate("abgelehnt")}>
              <XCircle className="h-3.5 w-3.5" /> Ablehnen
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-destructive hover:bg-destructive/10" disabled={bulkLoading}>
                  <Trash2 className="h-3.5 w-3.5" /> Löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{selected.size} Bewerbungen löschen?</AlertDialogTitle>
                  <AlertDialogDescription>Dies kann nicht rückgängig gemacht werden.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={bulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Endgültig löschen</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelected(new Set())}>Abwählen</Button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="Keine Bewerbungen" description="Es liegen aktuell keine Bewerbungen vor." />
      ) : (
        <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-3 py-3 w-10">
                  <Checkbox
                    checked={paged.length > 0 && paged.every((a) => selected.has(a.id))}
                    onCheckedChange={() => toggleSelectAllPage(paged.map((a) => a.id), paged.every((a) => selected.has(a.id)))}
                  />
                </th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">E-Mail</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Telefon</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tenant</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Datum</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paged.map((app) => {
                const isNew = app.status === "neu" || app.status === "eingegangen";
                const isLoading = actionLoading === app.id;
                const isSelected = selected.has(app.id);
                return (
                  <tr key={app.id} className={`hover:bg-muted/20 transition-colors cursor-pointer group ${isSelected ? "bg-primary/5" : ""}`} onClick={() => navigate(`/admin/applications/${app.id}`)}>
                    <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(app.id)} />
                    </td>
                    <td className="px-5 py-3.5 font-medium text-foreground">
                      {app.first_name && app.last_name ? `${app.first_name} ${app.last_name}` : app.full_name}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{app.email}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{app.phone || "–"}</td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                      {!app.tenant_id ? (
                        <span className="text-orange-600 dark:text-orange-400" title="Bewerbung wurde ohne Tenant-Zuordnung eingereicht (z.B. von einer nicht zugeordneten Domain). Bitte im Detail manuell zuweisen.">⚠️ Kein Tenant</span>
                      ) : tenantMap[app.tenant_id]?.name ? (
                        tenantMap[app.tenant_id].name
                      ) : (
                        <span className="text-red-600 dark:text-red-400" title={`Tenant-ID ${app.tenant_id} existiert nicht mehr (gelöscht?) oder ist für dich nicht sichtbar.`}>⚠️ Unbekannt</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge variant="secondary" className={`text-[10px] ${statusColor(app.status)}`}>{statusLabel(app.status)}</Badge>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs">{new Date(app.created_at).toLocaleDateString("de-DE")}</td>
                    <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1.5 items-center">
                        {isNew && (
                          <>
                            <Button
                              variant="default"
                              size="sm"
                              className="h-8 text-xs gap-1 bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
                              onClick={(e) => acceptApplication(app, e)}
                              disabled={isLoading}
                            >
                              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                              Annehmen
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                              onClick={(e) => rejectApplication(app, e)}
                              disabled={isLoading}
                            >
                              <XCircle className="h-3.5 w-3.5" /> Ablehnen
                            </Button>
                          </>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Bewerbung löschen?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Die Bewerbung von <strong>{app.full_name}</strong> wird unwiderruflich gelöscht.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteApplication(app.id, app.full_name)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {deleting === app.id ? "Löschen…" : "Endgültig löschen"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-border bg-muted/20">
            <PaginationBar page={page} pageCount={pageCount} setPage={setPage} rangeFrom={rangeFrom} rangeTo={rangeTo} total={total} />
          </div>
        </div>
      )}

      <Dialog open={dripOpen} onOpenChange={(o) => { if (!resendInvitesLoading) setDripOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Eye className="h-4 w-4" /> Vorschau: Drip-Einladungen</DialogTitle>
            <DialogDescription>
              Keine Mail wurde gesendet. Prüfe Empfängerzahl und Verteilung, dann freigeben.
            </DialogDescription>
          </DialogHeader>

          {previewLoading || !preview ? (
            <div className="py-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Lade Vorschau…
            </div>
          ) : (
            <div className="space-y-4">
              <div className={`grid gap-3 text-center ${previewAlreadyQueued > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
                <div className="rounded-lg border p-3 bg-primary/5">
                  <div className="text-2xl font-bold text-primary">{previewWouldQueue}</div>
                  <div className="text-[11px] text-muted-foreground">Neu in dieser Welle</div>
                </div>
                {previewAlreadyQueued > 0 && (
                  <div className="rounded-lg border p-3">
                    <div className="text-2xl font-bold text-muted-foreground">{previewAlreadyQueued}</div>
                    <div className="text-[11px] text-muted-foreground">Schon in Queue</div>
                  </div>
                )}
                <div className="rounded-lg border p-3">
                  <div className="text-2xl font-bold">{previewEligible}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {previewAlreadyQueued > 0 ? "Gesamt offen" : "Offen für Einladung"}
                  </div>
                </div>
              </div>

              {preview.stats && (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
                  <div className="font-medium text-muted-foreground">Filter-Statistik (akzeptierte Bewerbungen)</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                    <span>Akzeptiert gesamt: <strong className="text-foreground">{preview.stats.acceptedTotal}</strong></span>
                    <span>− ohne E-Mail/Tenant: <strong className="text-foreground">{preview.stats.missingEmailOrTenant}</strong></span>
                    <span>− bereits registriert: <strong className="text-foreground">{preview.stats.alreadyRegistered}</strong></span>
                    <span>− Doppel-Bewerbungen (gleiche E-Mail): <strong className="text-foreground">{preview.stats.duplicateEmail}</strong></span>
                    <span>= übrig: <strong className="text-foreground">{previewEligible}</strong></span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs">Versand über (Stunden, 1–168)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={1} max={168} value={windowHours}
                    onChange={(e) => setWindowHours(Math.max(1, Math.min(168, parseInt(e.target.value, 10) || 24)))}
                    className="h-9 w-32"
                  />
                  <span className="text-xs text-muted-foreground">
                    ≈ {previewWouldQueue && windowHours > 0 ? Math.round((previewWouldQueue / windowHours) * 10) / 10 : 0} Mails/Stunde im Schnitt
                  </span>
                </div>
              </div>

              {Object.keys(preview.perTenant).length > 0 && (
                <div className="text-xs space-y-1">
                  <div className="font-medium text-muted-foreground">Verteilung pro Tenant:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(preview.perTenant).map(([tid, n]) => (
                      <Badge key={tid} variant="secondary" className="text-[10px]">
                        {tenantMap[tid]?.name ?? tid.slice(0, 8)}: {n}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {preview.items.length > 0 && (
                <div className="text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-muted-foreground">
                      {preview.items.length} Empfänger ({previewSelected.size} ausgewählt)
                    </div>
                    {previewSelected.size > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                        disabled={rejectingPreview}
                        onClick={rejectPreviewSelected}
                      >
                        {rejectingPreview ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                        Auswahl auf "abgelehnt" setzen ({previewSelected.size})
                      </Button>
                    )}
                  </div>
                  <div className="max-h-[55vh] overflow-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                        <tr className="border-b">
                          <th className="px-2 py-2 w-8">
                            <Checkbox
                              checked={preview.items.length > 0 && preview.items.every((i) => previewSelected.has(i.id))}
                              onCheckedChange={(v) => {
                                if (v) setPreviewSelected(new Set(preview.items.map((i) => i.id)));
                                else setPreviewSelected(new Set());
                              }}
                            />
                          </th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">E-Mail</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Telefon</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tenant</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Datum</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {preview.items.map((it) => {
                          const sel = previewSelected.has(it.id);
                          return (
                            <tr key={it.id} className={sel ? "bg-destructive/5" : "hover:bg-muted/30"}>
                              <td className="px-2 py-1.5">
                                <Checkbox
                                  checked={sel}
                                  onCheckedChange={() => {
                                    const next = new Set(previewSelected);
                                    if (next.has(it.id)) next.delete(it.id); else next.add(it.id);
                                    setPreviewSelected(next);
                                  }}
                                />
                              </td>
                              <td className="px-3 py-1.5 font-medium">
                                {it.first_name && it.last_name ? `${it.first_name} ${it.last_name}` : (it.full_name ?? "—")}
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground">{it.email}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{it.phone || "–"}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{tenantMap[it.tenant_id]?.name ?? "?"}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{new Date(it.created_at).toLocaleDateString("de-DE")}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDripOpen(false)} disabled={resendInvitesLoading}>Abbrechen</Button>
            <Button
              onClick={confirmDripSend}
              disabled={resendInvitesLoading || previewLoading || rejectingPreview || !preview || previewWouldQueue === 0}
            >
              {resendInvitesLoading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <MailPlus className="h-4 w-4 mr-1.5" />}
              {preview ? `${previewWouldQueue} neue Einladungen einplanen` : "Einplanen"}
            </Button>
          </DialogFooter>
        </DialogContent>

      </Dialog>

      <Dialog open={queueDetailsOpen} onOpenChange={setQueueDetailsOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Drip-Queue · Details</DialogTitle>
            <DialogDescription>Einzelne Einträge nach Status. Max. 500 pro Liste.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-1 border-b mb-3">
            {([
              ["queued", `Ausstehend (${queueStatus?.counts.queued ?? 0})`],
              ["sent", `Gesendet (${queueStatus?.counts.sent ?? 0})`],
              ["failed", `Fehlgeschlagen (${queueStatus?.counts.failed ?? 0})`],
              ["skipped", `Übersprungen (${queueStatus?.counts.skipped ?? 0})`],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setQueueTab(k)}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${queueTab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >{label}</button>
            ))}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            {queueItemsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : queueItems.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">Keine Einträge.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">E-Mail</th>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">{queueTab === "sent" ? "Gesendet" : "Geplant"}</th>
                    <th className="text-left p-2">Versuche</th>
                    {queueTab !== "sent" && queueTab !== "queued" && <th className="text-left p-2">Fehler</th>}
                  </tr>
                </thead>
                <tbody>
                  {queueItems.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="p-2 font-mono">{it.email}</td>
                      <td className="p-2">{it.full_name ?? "—"}</td>
                      <td className="p-2 whitespace-nowrap">
                        {new Date(queueTab === "sent" ? (it.sent_at ?? it.scheduled_at) : it.scheduled_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="p-2">{it.attempts}</td>
                      {queueTab !== "sent" && queueTab !== "queued" && (
                        <td className="p-2 text-destructive max-w-[280px] truncate" title={it.last_error ?? ""}>{it.last_error ?? "—"}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQueueDetailsOpen(false)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}
