import { useState, useEffect, useCallback, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getContractOverride,
  saveContractOverrideHtml,
  saveContractOverridePdf,
  saveContractOverrideSalary,
  deleteContractOverride,
} from "@/lib/employee-contract-override.functions";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, FileText, Pencil, Trash2, Loader2, Check, Search, Wallet,
} from "lucide-react";

interface EmployeeOption {
  user_id: string;
  full_name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: EmployeeOption[];
  /** Optional: opens dialog pre-selecting this user_id */
  initialUserId?: string | null;
}

export function IndividualContractDialog({ open, onOpenChange, employees, initialUserId }: Props) {
  const { toast } = useToast();
  const getOv = useServerFn(getContractOverride);
  const saveHtml = useServerFn(saveContractOverrideHtml);
  const savePdf = useServerFn(saveContractOverridePdf);
  const saveSalary = useServerFn(saveContractOverrideSalary);
  const deleteOv = useServerFn(deleteContractOverride);

  const [userId, setUserId] = useState<string | null>(initialUserId ?? null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<"editor" | "pdf">("editor");
  const [html, setHtml] = useState("");
  const [existing, setExisting] = useState<any>(null);
  const [pdfSignedUrl, setPdfSignedUrl] = useState<string | null>(null);
  const [salaryEuro, setSalaryEuro] = useState<string>("");
  const [hours, setHours] = useState<string>("");

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? employees.filter((e) => (e.full_name ?? "").toLowerCase().includes(q))
      : employees;
    return list.slice(0, 50);
  }, [employees, search]);

  const selected = employees.find((e) => e.user_id === userId) ?? null;

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setUserId(initialUserId ?? null);
      setSearch("");
      setHtml("");
      setExisting(null);
      setPdfSignedUrl(null);
      setSalaryEuro("");
      setHours("");
      setMode("editor");
    }
  }, [open, initialUserId]);

  const reload = useCallback(async (uid: string) => {
    setLoading(true);
    try {
      const res = await getOv({ data: { user_id: uid } });
      const ov = (res as any).override;
      setExisting(ov);
      if (ov?.html_body) {
        setHtml(ov.html_body);
        setMode("editor");
      } else if (ov?.pdf_url) {
        setMode("pdf");
        const { data } = await supabase.storage.from("documents").createSignedUrl(ov.pdf_url, 600);
        setPdfSignedUrl(data?.signedUrl ?? null);
      } else {
        setHtml("");
        setPdfSignedUrl(null);
      }
      setSalaryEuro(ov?.monthly_salary_cents != null ? (ov.monthly_salary_cents / 100).toString().replace(".", ",") : "");
      setHours(ov?.weekly_hours != null ? String(ov.weekly_hours).replace(".", ",") : "");
    } catch (e: any) {
      toast({ title: "Fehler beim Laden", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [getOv, toast]);

  useEffect(() => {
    if (userId) reload(userId);
  }, [userId, reload]);

  const parseSalaryCents = (): number | null => {
    const s = salaryEuro.trim().replace(/\./g, "").replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };
  const parseHours = (): number | null => {
    const s = hours.trim().replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    if (!isFinite(n) || n < 0) return null;
    return n;
  };

  const handleSaveSalary = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await saveSalary({
        data: {
          user_id: userId,
          monthly_salary_cents: parseSalaryCents(),
          weekly_hours: parseHours(),
        },
      });
      toast({ title: "Gehalt / Stunden gespeichert" });
      await reload(userId);
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveHtml = async () => {
    if (!userId) return;
    if (html.trim().length < 10) {
      toast({ title: "Vertragstext zu kurz", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await saveHtml({ data: { user_id: userId, html_body: html } });
      // Gehalt + Stunden ebenfalls speichern, falls eingegeben.
      if (parseSalaryCents() !== null || parseHours() !== null) {
        await saveSalary({
          data: {
            user_id: userId,
            monthly_salary_cents: parseSalaryCents(),
            weekly_hours: parseHours(),
          },
        });
      }
      toast({ title: "Individueller Vertrag gespeichert", description: "Mitarbeiter sieht ihn beim nächsten Login." });
      await reload(userId);
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadPdf = async (file: File) => {
    if (!userId) return;
    if (file.type !== "application/pdf") {
      toast({ title: "Nur PDF-Dateien", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const path = `contract-overrides/${userId}/${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upErr) throw upErr;
      await savePdf({ data: { user_id: userId, pdf_url: path } });
      toast({ title: "PDF hochgeladen" });
      await reload(userId);
    } catch (e: any) {
      toast({ title: "Upload fehlgeschlagen", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!userId) return;
    if (!confirm("Override wirklich entfernen? Mitarbeiter sieht dann wieder die Standard-Tenant-Vorlage.")) return;
    try {
      await deleteOv({ data: { user_id: userId } });
      setHtml("");
      setExisting(null);
      setPdfSignedUrl(null);
      setSalaryEuro("");
      setHours("");
      toast({ title: "Override entfernt" });
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Individueller Arbeitsvertrag</DialogTitle>
        </DialogHeader>

        {/* Mitarbeiter-Auswahl */}
        {!selected ? (
          <div className="space-y-3">
            <Label className="text-xs">Mitarbeiter wählen</Label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name suchen…"
                className="pl-8 h-9 text-sm"
                autoFocus
              />
            </div>
            <div className="border rounded-lg divide-y divide-border max-h-80 overflow-y-auto">
              {filteredEmployees.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4 text-center">Keine Treffer.</p>
              ) : (
                filteredEmployees.map((e) => (
                  <button
                    key={e.user_id}
                    onClick={() => setUserId(e.user_id)}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted/40 transition-colors"
                  >
                    {e.full_name || e.user_id}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Mitarbeiter</p>
                <p className="text-sm font-medium">{selected.full_name}</p>
              </div>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setUserId(null)}>
                Wechseln
              </Button>
            </div>

            {existing && (
              <div className="flex items-center gap-2 text-[11px] text-accent bg-accent/10 px-3 py-2 rounded-lg">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  Override aktiv – zuletzt aktualisiert {new Date(existing.updated_at).toLocaleString("de-DE")}
                </span>
                <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs text-destructive" onClick={handleDelete}>
                  <Trash2 className="h-3 w-3 mr-1" /> Entfernen
                </Button>
              </div>
            )}

            {/* Gehalt + Stunden */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Individuelles Gehalt & Wochenstunden
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Überschreibt die Defaults (Minijob 556 € / Teilzeit 1.200 € / Vollzeit 2.400 €).
                Leer lassen, um den Default zu nutzen.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px]">Monatsgehalt (€)</Label>
                  <Input
                    inputMode="decimal"
                    value={salaryEuro}
                    onChange={(e) => setSalaryEuro(e.target.value)}
                    placeholder="z. B. 603 oder 1300,50"
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Wochenstunden</Label>
                  <Input
                    inputMode="decimal"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder="z. B. 20"
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <Button size="sm" onClick={handleSaveSalary} disabled={saving || loading} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Gehalt & Stunden speichern
              </Button>
            </div>

            {/* Editor / PDF Tabs */}
            <div className="flex gap-2 border-b border-border">
              <button
                type="button"
                onClick={() => setMode("editor")}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  mode === "editor" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Pencil className="h-3.5 w-3.5 inline mr-1" /> Text-Editor
              </button>
              <button
                type="button"
                onClick={() => setMode("pdf")}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  mode === "pdf" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="h-3.5 w-3.5 inline mr-1" /> PDF hochladen
              </button>
            </div>

            {loading ? (
              <p className="text-xs text-muted-foreground animate-pulse">Laden…</p>
            ) : mode === "editor" ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Platzhalter wie <code className="bg-muted px-1 rounded">{"{{first_name}}"}</code>,{" "}
                  <code className="bg-muted px-1 rounded">{"{{monthly_salary}}"}</code>,{" "}
                  <code className="bg-muted px-1 rounded">{"{{weekly_hours}}"}</code>,{" "}
                  <code className="bg-muted px-1 rounded">{"{{start_date}}"}</code> werden beim Anzeigen für den Mitarbeiter ersetzt.
                </p>
                <Textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  placeholder="Vertragstext einfügen oder schreiben…"
                  rows={14}
                  className="font-mono text-xs"
                />
                <Button size="sm" onClick={handleSaveHtml} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Speichern & zur Unterschrift senden
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {pdfSignedUrl && (
                  <div className="border rounded-lg overflow-hidden bg-muted/20">
                    <iframe src={pdfSignedUrl} className="w-full h-[400px]" title="Aktueller Override-PDF" />
                  </div>
                )}
                <div>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => e.target.files?.[0] && handleUploadPdf(e.target.files[0])}
                    disabled={uploading}
                    className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:font-medium file:cursor-pointer file:hover:bg-primary/90"
                  />
                  {uploading && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      <Loader2 className="h-3 w-3 inline animate-spin mr-1" /> Wird hochgeladen…
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
