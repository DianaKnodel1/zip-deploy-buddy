import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { useToast } from "@/hooks/use-toast";
import { BellRing, RefreshCw, CheckCircle2, XCircle, Send, Clock } from "lucide-react";

export const Route = createFileRoute("/admin/reminders")({
  component: AdminRemindersPage,
});

interface ReminderRow {
  id: string;
  email: string;
  tenant_id: string | null;
  reminder_type: string;
  attempt: number;
  sent_at: string;
  status: string;
  error: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  invite: "Einladung (Bewerber)",
  confirm_email: "E-Mail bestätigen",
  complete_registration: "Registrierung abschließen",
  no_recent_booking: "Keine Buchung (7+ Tage)",
};

function AdminRemindersPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [running, setRunning] = useState<"send" | "dry" | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("reminder_log" as any)
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(500);
    setRows((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(r => {
    if (filterType !== "all" && r.reminder_type !== filterType) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (search && !r.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [rows, filterType, filterStatus, search]);

  const stats = useMemo(() => {
    const sent = rows.filter(r => r.status === "sent").length;
    const failed = rows.filter(r => r.status === "failed").length;
    const last24h = rows.filter(r => Date.now() - new Date(r.sent_at).getTime() < 86400_000).length;
    return { total: rows.length, sent, failed, last24h };
  }, [rows]);

  const trigger = async (dry: boolean) => {
    setRunning(dry ? "dry" : "send");
    try {
      const { data, error } = await supabase.functions.invoke("send-reminders", {
        body: dry ? { dry_run: true, ignore_quiet_hours: true } : { ignore_quiet_hours: true },
      });
      if (error) throw new Error(error.message);
      toast({
        title: dry ? "Dry-Run abgeschlossen" : "Erinnerungen verarbeitet",
        description: `Gesendet: ${(data as any)?.sent ?? 0} · Übersprungen: ${(data as any)?.skipped ?? 0} · Fehler: ${(data as any)?.failed ?? 0}`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setRunning(null);
    }
  };

  if (loading) return <div className="p-6 lg:p-8 space-y-5"><PageHeaderSkeleton /><TableSkeleton rows={8} cols={6} /></div>;

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
            <BellRing className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold">Erinnerungs-Mails</h1>
            <p className="text-sm text-muted-foreground">
              Automatischer Versand zwischen 08:00–20:00 Europe/Berlin · max. 5 Mails pro Empfänger · min. 3 Tage Abstand
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => trigger(true)} disabled={running !== null}>
            <Clock className={`h-4 w-4 mr-1.5 ${running === "dry" ? "animate-spin" : ""}`} />
            Dry-Run (nur zählen)
          </Button>
          <Button size="sm" onClick={() => trigger(false)} disabled={running !== null}>
            <Send className={`h-4 w-4 mr-1.5 ${running === "send" ? "animate-spin" : ""}`} />
            Jetzt senden
          </Button>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-2xl font-bold">{stats.total}</p>
          <p className="text-xs text-muted-foreground">Gesamt (letzte 500)</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-2xl font-bold text-status-success">{stats.sent}</p>
          <p className="text-xs text-muted-foreground">Erfolgreich</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className={`text-2xl font-bold ${stats.failed > 0 ? "text-destructive" : ""}`}>{stats.failed}</p>
          <p className="text-xs text-muted-foreground">Fehlgeschlagen</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-2xl font-bold">{stats.last24h}</p>
          <p className="text-xs text-muted-foreground">Letzte 24 Stunden</p>
        </CardContent></Card>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-64 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Typen</SelectItem>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="sent">Gesendet</SelectItem>
            <SelectItem value="failed">Fehler</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Empfänger suchen…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs h-9 text-sm" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={BellRing} title="Keine Erinnerungen" description="Noch keine Reminder-Mails versendet oder kein Treffer für diesen Filter." />
      ) : (
        <div className="border rounded-xl overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Empfänger</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Typ</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Versuch</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Zeitpunkt</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Fehler</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {r.status === "sent"
                        ? <CheckCircle2 className="h-4 w-4 text-status-success" />
                        : <XCircle className="h-4 w-4 text-destructive" />}
                      <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-xs">{r.email}</td>
                  <td className="px-4 py-3"><Badge variant="secondary" className="text-[10px]">{TYPE_LABELS[r.reminder_type] ?? r.reminder_type}</Badge></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.attempt} / 5</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(r.sent_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-xs text-destructive max-w-[240px] truncate">{r.error ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}