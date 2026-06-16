import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { AdminEmailLogsPage } from "./admin.email-logs";
import { AdminRemindersPage } from "./admin.reminders";
import { AdminRecoveryPage } from "./admin.recovery";
import { CronHealthPanel } from "@/components/CronHealthPanel";
import type { EmailLog } from "@/lib/email-stats";
import { EMAIL_TYPE_LABELS } from "@/lib/email-stats";

const searchSchema = z.object({
  tab: z.enum(["overview", "logs", "reminders", "recovery", "cron"]).optional().catch("overview"),
});

export const Route = createFileRoute("/admin/email-center")({
  validateSearch: searchSchema,
  component: AdminEmailCenterPage,
});

type Bucket = { sent: number; pending: number; failed: number; bounced: number; total: number };

function emptyBucket(): Bucket {
  return { sent: 0, pending: 0, failed: 0, bounced: 0, total: 0 };
}

function dedupByMessageId(rows: EmailLog[]): EmailLog[] {
  // Rows kommen DESC sortiert → erster Treffer = aktuellster Status
  const seen = new Map<string, EmailLog>();
  for (const r of rows) {
    const k = r.message_id || `__nomid__${r.id}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  return Array.from(seen.values());
}

function bucketize(rows: EmailLog[]): Bucket {
  const b = emptyBucket();
  for (const r of rows) {
    b.total++;
    if (r.status === "sent") b.sent++;
    else if (r.status === "pending") b.pending++;
    else if (r.status === "bounced") b.bounced++;
    else if (["failed", "dlq"].includes(r.status)) b.failed++;
  }
  return b;
}

function OverviewTab() {
  const [loading, setLoading] = useState(true);
  const [by24h, setBy24h] = useState<Record<string, Bucket>>({});
  const [by7d, setBy7d] = useState<Record<string, Bucket>>({});
  const [totals24h, setTotals24h] = useState<Bucket>(emptyBucket());

  const load = async () => {
    setLoading(true);
    const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();
    const cutoff24 = Date.now() - 86400_000;
    const { data } = await supabase
      .from("email_send_log")
      .select("id, message_id, template_name, recipient_email, status, error_message, metadata, created_at")
      .gte("created_at", since7d)
      .order("created_at", { ascending: false })
      .limit(10000);

    const rows7d = dedupByMessageId((data ?? []) as EmailLog[]);
    const rows24 = rows7d.filter(r => new Date(r.created_at).getTime() >= cutoff24);

    const group = (rows: EmailLog[]) => {
      const out: Record<string, Bucket> = {};
      for (const r of rows) {
        const t = r.template_name || "unknown";
        out[t] ??= emptyBucket();
        const b = out[t];
        b.total++;
        if (r.status === "sent") b.sent++;
        else if (r.status === "pending") b.pending++;
        else if (r.status === "bounced") b.bounced++;
        else if (["failed", "dlq"].includes(r.status)) b.failed++;
      }
      return out;
    };

    setBy24h(group(rows24));
    setBy7d(group(rows7d));
    setTotals24h(bucketize(rows24));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const templates = useMemo(() => {
    const keys = new Set([...Object.keys(by24h), ...Object.keys(by7d)]);
    return Array.from(keys).sort();
  }, [by24h, by7d]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Live-Übersicht</h2>
          <p className="text-xs text-muted-foreground">Eindeutige E-Mails (dedupliziert per Message-ID)</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={CheckCircle2} label="Gesendet 24 h" value={totals24h.sent} tone="success" />
        <KpiCard icon={Clock} label="In Warteschlange" value={totals24h.pending} tone={totals24h.pending > 0 ? "warning" : "neutral"} />
        <KpiCard icon={XCircle} label="Fehler 24 h" value={totals24h.failed + totals24h.bounced} tone={(totals24h.failed + totals24h.bounced) > 0 ? "danger" : "neutral"} />
        <KpiCard icon={Mail} label="Gesamt 24 h" value={totals24h.total} tone="neutral" />
      </div>

      {totals24h.pending > 20 && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-200">
            <strong>{totals24h.pending}</strong> Mails hängen in der Warteschlange. Wenn der Cron läuft, wird das innerhalb der nächsten Minuten auf „Gesendet" wechseln.
            Bei dauerhaftem Stillstand siehe Tab <em>Erinnerungen → Reminder-Cron</em>.
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase">Template</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase">Gesendet 24h</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase">Wartet 24h</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase">Fehler 24h</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase">Gesendet 7d</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase">Fehler 7d</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {templates.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {loading ? "Lade…" : "Keine E-Mails in den letzten 7 Tagen."}
                </td></tr>
              )}
              {templates.map(t => {
                const a = by24h[t] ?? emptyBucket();
                const b = by7d[t] ?? emptyBucket();
                return (
                  <tr key={t} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary" className="text-[10px]">{EMAIL_TYPE_LABELS[t] ?? t}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-medium tabular-nums">{a.sent}</td>
                    <td className={`px-3 py-2.5 text-right text-xs tabular-nums ${a.pending > 0 ? "text-amber-700 dark:text-amber-300 font-semibold" : "text-muted-foreground"}`}>{a.pending}</td>
                    <td className={`px-3 py-2.5 text-right text-xs tabular-nums ${(a.failed + a.bounced) > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{a.failed + a.bounced}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">{b.sent}</td>
                    <td className={`px-3 py-2.5 text-right text-xs tabular-nums ${(b.failed + b.bounced) > 0 ? "text-destructive" : "text-muted-foreground"}`}>{b.failed + b.bounced}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: "success" | "danger" | "warning" | "neutral" }) {
  const cls = {
    success: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    danger: "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300",
    warning: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-300",
    neutral: "bg-muted/40 border-border text-foreground",
  }[tone];
  return (
    <Card className={`border ${cls}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className="h-5 w-5 opacity-80" />
        <div>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-[11px] opacity-80">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminEmailCenterPage() {
  const search = useSearch({ from: "/admin/email-center" });
  const navigate = useNavigate();
  const tab = (search as any).tab ?? "overview";

  const setTab = (v: string) => {
    navigate(`/admin/email-center?tab=${v}`);
  };

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold">E-Mail-Center</h1>
          <p className="text-sm text-muted-foreground">Status, Protokoll, Erinnerungen und Recovery an einem Ort.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="h-10">
          <TabsTrigger value="overview" className="text-xs">Übersicht</TabsTrigger>
          <TabsTrigger value="logs" className="text-xs">Protokoll</TabsTrigger>
          <TabsTrigger value="reminders" className="text-xs">Erinnerungen</TabsTrigger>
          <TabsTrigger value="recovery" className="text-xs">Recovery</TabsTrigger>
          <TabsTrigger value="cron" className="text-xs">Cron-Health</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="logs" className="mt-0">
          <div className="-mx-6 lg:-mx-8 -mb-6 lg:-mb-8">
            <AdminEmailLogsPage />
          </div>
        </TabsContent>
        <TabsContent value="reminders" className="mt-0">
          <div className="-mx-6 lg:-mx-8 -mb-6 lg:-mb-8">
            <AdminRemindersPage />
          </div>
        </TabsContent>
        <TabsContent value="recovery" className="mt-0">
          <div className="-mx-6 lg:-mx-8 -mb-6 lg:-mb-8">
            <AdminRecoveryPage />
          </div>
        </TabsContent>
        <TabsContent value="cron" className="mt-5">
          <CronHealthPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
