import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, Users, AlertTriangle, History } from "lucide-react";
import {
  enqueueDomainRecoveryMails,
  getAffectedRecipients,
  type AffectedRecipient,
} from "@/lib/tenant-domains.functions";

export const Route = createFileRoute("/admin/recovery")({
  component: AdminRecoveryPage,
});

interface Tenant { id: string; name: string; domain: string | null; primary_domain: string | null }

function AdminRecoveryPage() {
  const { toast } = useToast();
  const sendFn = useServerFn(enqueueDomainRecoveryMails);
  const affectedFn = useServerFn(getAffectedRecipients);

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string>("");
  const [recipients, setRecipients] = useState<AffectedRecipient[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<Array<{ id: string; created_at: string; comment: string | null }>>([]);

  const loadHistory = async (tid: string) => {
    const { data } = await (supabase as any)
      .from("activity_log")
      .select("id,created_at,comment")
      .eq("entity_type", "tenant")
      .eq("entity_id", tid)
      .eq("action", "domain_recovery_versendet")
      .order("created_at", { ascending: false })
      .limit(10);
    setHistory((data ?? []) as any);
  };

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("tenants").select("id,name,domain,primary_domain").eq("is_active", true).order("name");
      setTenants((data ?? []) as Tenant[]);
    })();
  }, []);

  useEffect(() => {
    if (!tenantId) { setRecipients([]); setHistory([]); return; }
    setLoadingPreview(true);
    affectedFn({ data: { tenant_id: tenantId } })
      .then((r) => setRecipients(r.recipients))
      .catch((e) => toast({ title: "Fehler", description: String(e?.message ?? e), variant: "destructive" }))
      .finally(() => setLoadingPreview(false));
    loadHistory(tenantId);
  }, [tenantId]);

  const send = async (dryRun: boolean) => {
    if (!tenantId) return;
    setSending(true); setResult(null);
    try {
      const r = await sendFn({ data: { tenant_id: tenantId, dry_run: dryRun } });
      setResult(r);
      if (!dryRun) loadHistory(tenantId);
      toast({
        title: dryRun ? "Dry-Run abgeschlossen" : "Recovery-Mails versendet",
        description: `${r.sent ?? 0} gesendet · ${r.skipped ?? 0} übersprungen · ${r.failed ?? 0} fehlgeschlagen`,
      });
    } catch (e: any) {
      toast({ title: "Fehler", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const selectedTenant = tenants.find(t => t.id === tenantId);
  const activeDomain = selectedTenant?.primary_domain ?? selectedTenant?.domain;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Domain-Recovery</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sendet allen Mitarbeitern eines Tenants den neuen Portal-Link der aktuellen Primary-Domain.
          Nutze diese Aktion <strong>nach</strong> einem Domain-Wechsel auf <code>/admin/domains</code>.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <label className="text-sm font-medium">Tenant auswählen</label>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">— bitte wählen —</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.primary_domain ?? t.domain})
              </option>
            ))}
          </select>

          {selectedTenant && (
            <div className="rounded-md border bg-muted/40 p-4 text-sm space-y-1">
              <div>Aktive Versand-Domain: <Badge variant="secondary">portal.{activeDomain}</Badge></div>
              <div className="text-muted-foreground">
                Der Portal-Link wird automatisch aus dieser Domain gebildet. Falls sie falsch ist, erst auf <code>/admin/domains</code> umstellen.
              </div>
            </div>
          )}

          {tenantId && (
            <div className="rounded-md border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                Betroffene Mitarbeiter
              </div>
              {loadingPreview ? (
                <div className="text-sm text-muted-foreground mt-2 flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Lade…</div>
              ) : (
                <div className="text-sm mt-2">
                  <strong>{recipients.length}</strong> Empfänger werden insgesamt angeschrieben.
                  <div className="text-xs text-muted-foreground mt-1">
                    Bewerber bewusst ausgeschlossen — die bekommen den neuen Link automatisch über den normalen Reminder-Flow.
                    Der Versand läuft gestaffelt (max. 20 Mails pro Cron-Lauf ≈ 200/12h pro Tenant) und startet nach dem nächsten Domain-Wechsel automatisch. Pro Domain-Wechsel erhält jeder Mitarbeiter genau eine Mail.
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" disabled={!tenantId || sending} onClick={() => send(true)}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Dry-Run"}
            </Button>
            <Button disabled={!tenantId || sending || recipients.length === 0} onClick={() => send(false)}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Recovery-Mails jetzt senden
            </Button>
          </div>

          {result && (
            <div className="rounded-md border bg-muted/40 p-4 text-sm">
              <div className="font-medium mb-2 flex items-center gap-2">
                {result.failed > 0 ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : null}
                Ergebnis
              </div>
              <pre className="text-xs overflow-auto max-h-64">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}

          {tenantId && (
            <div className="rounded-md border p-4">
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <History className="h-4 w-4" />
                Vergangene Recovery-Läufe
              </div>
              {history.length === 0 ? (
                <div className="text-xs text-muted-foreground">Noch kein Bulk-Re-Send für diesen Tenant durchgeführt.</div>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {history.map(h => (
                    <li key={h.id} className="flex gap-3 border-b pb-1.5 last:border-0">
                      <span className="text-muted-foreground whitespace-nowrap">
                        {new Date(h.created_at).toLocaleString("de-DE")}
                      </span>
                      <span>{h.comment ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
