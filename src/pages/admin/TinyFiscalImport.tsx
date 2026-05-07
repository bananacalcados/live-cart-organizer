import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, PlayCircle, Database, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface RunRow {
  id: string;
  run_type: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  dry_run: boolean;
  total_processed: number;
  success_count: number;
  failure_count: number;
  stats: any;
}

export default function TinyFiscalImport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [runningDiscovery, setRunningDiscovery] = useState(false);
  const [runningImport, setRunningImport] = useState(false);
  const [lastDiscovery, setLastDiscovery] = useState<RunRow | null>(null);
  const [lastImport, setLastImport] = useState<RunRow | null>(null);
  const [dedupCount, setDedupCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [batchSize, setBatchSize] = useState<number>(200);
  const [concurrency, setConcurrency] = useState<number>(12);
  const [autoRun, setAutoRun] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{ batches: number; ok: number; errors: number } | null>(null);
  const [runningValidate, setRunningValidate] = useState(false);
  const [lastValidate, setLastValidate] = useState<RunRow | null>(null);
  const [divergentCount, setDivergentCount] = useState<number | null>(null);
  const [pendingValidationCount, setPendingValidationCount] = useState<number | null>(null);
  const autoRunRef = useRef(false);

  const loadStatus = async () => {
    const { data: discRuns } = await supabase
      .from("tiny_import_runs").select("*").eq("run_type", "discovery").order("started_at", { ascending: false }).limit(1);
    setLastDiscovery((discRuns?.[0] as any) ?? null);

    const { data: impRuns } = await supabase
      .from("tiny_import_runs").select("*").eq("run_type", "import").order("started_at", { ascending: false }).limit(1);
    setLastImport((impRuns?.[0] as any) ?? null);

    const { count } = await supabase.from("product_dedup_index").select("*", { count: "exact", head: true });
    setDedupCount(count ?? 0);

    const { count: pending } = await supabase
      .from("product_dedup_index").select("*", { count: "exact", head: true }).is("imported_at", null);
    setPendingCount(pending ?? 0);

    const { count: imported } = await supabase
      .from("product_dedup_index").select("*", { count: "exact", head: true }).not("imported_at", "is", null);
    setImportedCount(imported ?? 0);

    const { data: valRuns } = await supabase
      .from("tiny_import_runs").select("*").eq("run_type", "cross_validation").order("started_at", { ascending: false }).limit(1);
    setLastValidate((valRuns?.[0] as any) ?? null);

    const { count: divCount } = await supabase
      .from("product_dedup_index").select("*", { count: "exact", head: true }).eq("validation_status", "divergent");
    setDivergentCount(divCount ?? 0);

    const { count: pendVal } = await supabase
      .from("product_dedup_index").select("*", { count: "exact", head: true }).is("validation_status", null);
    setPendingValidationCount(pendVal ?? 0);
  };

  useEffect(() => { loadStatus(); }, []);

  const runDiscovery = async (mode: "dry_run" | "persist") => {
    setRunningDiscovery(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiny-discover-unique-products", { body: { mode } });
      if (error) throw error;
      toast({
        title: mode === "dry_run" ? "Discovery (dry-run) concluído" : "Discovery persistido",
        description: `GTINs únicos: ${data?.stats?.unique_gtins ?? 0} • Fallback: ${data?.stats?.fallback_name_sku ?? 0} • Lidos: ${data?.stats?.total_pos_products ?? 0}`,
      });
      await loadStatus();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha", variant: "destructive" });
    } finally {
      setRunningDiscovery(false);
    }
  };

  const runImport = async (mode: "dry_run" | "persist") => {
    setRunningImport(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiny-import-fiscal-deduplicated", {
        body: { mode, limit: batchSize, skip_imported: true },
      });
      if (error) throw error;
      const s = data?.stats || {};
      toast({
        title: mode === "dry_run" ? "Import (dry-run) concluído" : "Import persistido",
        description: `Tiny OK: ${s.tiny_ok ?? 0}/${s.processed ?? 0} • Masters: ${s.masters_upserted ?? 0} • Variants: ${s.variants_upserted ?? 0} • c/NCM: ${s.with_ncm ?? 0}`,
      });
      await loadStatus();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha", variant: "destructive" });
    } finally {
      setRunningImport(false);
    }
  };

  const runImportAll = async () => {
    autoRunRef.current = true;
    setAutoRun(true);
    setAutoProgress({ batches: 0, ok: 0, errors: 0 });
    let batches = 0, ok = 0, errors = 0;
    try {
      while (true) {
        // Check pending
        const { count } = await supabase
          .from("product_dedup_index").select("*", { count: "exact", head: true }).is("imported_at", null);
        if (!count || count === 0) break;
        if (!autoRunRef.current) break;

        const { data, error } = await supabase.functions.invoke("tiny-import-fiscal-deduplicated", {
          body: { mode: "persist", limit: batchSize, skip_imported: true },
        });
        if (error) { errors++; break; }
        const s = data?.stats || {};
        batches++;
        ok += s.tiny_ok ?? 0;
        errors += (s.tiny_error ?? 0) + (s.skipped_no_tiny_id ?? 0);
        setAutoProgress({ batches, ok, errors });
        await loadStatus();

        if ((s.processed ?? 0) === 0) break; // safety
      }
      toast({ title: "Importação completa", description: `${batches} batches • ${ok} OK • ${errors} erros/skip` });
    } catch (e: any) {
      toast({ title: "Erro no auto-run", description: e?.message || "Falha", variant: "destructive" });
    } finally {
      setAutoRun(false);
      autoRunRef.current = false;
      await loadStatus();
    }
  };

  const stopAutoRun = () => { autoRunRef.current = false; };

  const runValidate = async (mode: "dry_run" | "persist") => {
    setRunningValidate(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiny-validate-cross-stores", {
        body: { mode, limit: 30 },
      });
      if (error) throw error;
      const s = data?.stats || {};
      toast({
        title: mode === "dry_run" ? "Validação (dry-run)" : "Validação persistida",
        description: `Processados: ${s.processed} • Consistentes: ${s.consistent} • Divergentes: ${s.divergent} • Erros Tiny: ${s.tiny_errors}`,
      });
      await loadStatus();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha", variant: "destructive" });
    } finally {
      setRunningValidate(false);
    }
  };

  const dStats = lastDiscovery?.stats || {};
  const iStats = lastImport?.stats || {};
  const vStats = lastValidate?.stats || {};

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Importação Fiscal Tiny</h1>
              <p className="text-xs text-muted-foreground">Pipeline global de deduplicação por GTIN</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Admin
          </Button>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>1. Discovery</CardTitle>
                <CardDescription>Varre todas as lojas ativas e agrupa produtos por GTIN único.</CardDescription>
              </div>
              {lastDiscovery && (
                <Badge variant={lastDiscovery.status === "completed" ? "default" : "secondary"}>
                  {lastDiscovery.status} {lastDiscovery.dry_run ? "(dry-run)" : ""}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="pos_products lidos" value={dStats.total_pos_products ?? "—"} />
              <Stat label="GTINs únicos" value={dStats.unique_gtins ?? "—"} />
              <Stat label="Fallback (name+sku)" value={dStats.fallback_name_sku ?? "—"} />
              <Stat label="No índice (total)" value={dedupCount ?? "—"} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => runDiscovery("dry_run")} disabled={runningDiscovery} variant="outline" className="gap-2">
                {runningDiscovery ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Rodar Discovery (dry-run)
              </Button>
              <Button onClick={() => runDiscovery("persist")} disabled={runningDiscovery} className="gap-2">
                {runningDiscovery ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Persistir
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>2. Importação Fiscal</CardTitle>
                <CardDescription>
                  Para cada produto único, busca dados fiscais (NCM, CEST, origem, peso, custo) no Tiny e popula <code>products_master</code> + <code>product_variants</code>.
                </CardDescription>
              </div>
              {lastImport && (
                <Badge variant={lastImport.status === "completed" ? "default" : "secondary"}>
                  {lastImport.status} {lastImport.dry_run ? "(dry-run)" : ""}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Pendentes (não importados)" value={pendingCount ?? "—"} />
              <Stat label="Já importados" value={importedCount ?? "—"} />
              <Stat label="Último: Tiny OK" value={`${iStats.tiny_ok ?? 0}/${iStats.processed ?? 0}`} />
              <Stat label="Último: c/ NCM" value={iStats.with_ncm ?? "—"} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <Mini label="Masters upsert" value={iStats.masters_upserted ?? 0} />
              <Mini label="Variants upsert" value={iStats.variants_upserted ?? 0} />
              <Mini label="Erros Tiny" value={iStats.tiny_error ?? 0} />
              <Mini label="Sem token/tiny_id" value={iStats.skipped_no_tiny_id ?? 0} />
            </div>

            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="batch" className="text-xs">Tamanho do batch</Label>
                <Input
                  id="batch" type="number" min={1} max={300}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Math.min(300, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-28"
                />
              </div>
              <div className="text-xs text-muted-foreground pb-2">
                Tiny ~3 req/s. 20 = ~10s, 100 = ~50s. Cada batch importa apenas os pendentes.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => runImport("dry_run")} disabled={runningImport || autoRun || (pendingCount ?? 0) === 0} variant="outline" className="gap-2">
                {runningImport ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Importar (dry-run)
              </Button>
              <Button onClick={() => runImport("persist")} disabled={runningImport || autoRun || (pendingCount ?? 0) === 0} variant="secondary" className="gap-2">
                {runningImport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Importar 1 batch
              </Button>
              {!autoRun ? (
                <Button onClick={runImportAll} disabled={runningImport || (pendingCount ?? 0) === 0} className="gap-2">
                  <PlayCircle className="h-4 w-4" />
                  Importar TUDO ({(pendingCount ?? 0).toLocaleString("pt-BR")} pendentes)
                </Button>
              ) : (
                <Button onClick={stopAutoRun} variant="destructive" className="gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Parar (em andamento)
                </Button>
              )}
            </div>

            {autoProgress && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                <div className="font-semibold text-primary">
                  {autoRun ? "Auto-import rodando..." : "Auto-import finalizado"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Batches: <b>{autoProgress.batches}</b> • OK: <b>{autoProgress.ok}</b> • Erros/skip: <b>{autoProgress.errors}</b>
                  {autoRun && <> • Pendentes restantes: <b>{(pendingCount ?? 0).toLocaleString("pt-BR")}</b></>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* CARD 3 - Cross-Validation */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>3. Cross-Validation</CardTitle>
                <CardDescription>
                  Compara os mesmos produtos (mesmo GTIN) entre as lojas Tiny e identifica divergências fiscais (NCM, CEST, origem, etc).
                </CardDescription>
              </div>
              {lastValidate && (
                <Badge variant={lastValidate.status === "completed" ? "default" : "secondary"}>
                  {lastValidate.status} {lastValidate.dry_run ? "(dry-run)" : ""}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Pendentes validação" value={pendingValidationCount ?? "—"} />
              <Stat label="Divergentes (total)" value={divergentCount ?? "—"} />
              <Stat label="Último: Consistentes" value={vStats.consistent ?? "—"} />
              <Stat label="Último: Divergentes" value={vStats.divergent ?? "—"} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <Mini label="Processados" value={vStats.processed ?? 0} />
              <Mini label="Single-store" value={vStats.single_store ?? 0} />
              <Mini label="Divergências escritas" value={vStats.divergences_written ?? 0} />
              <Mini label="Erros Tiny" value={vStats.tiny_errors ?? 0} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => runValidate("dry_run")} disabled={runningValidate} variant="outline" className="gap-2">
                {runningValidate ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Validar (dry-run)
              </Button>
              <Button onClick={() => runValidate("persist")} disabled={runningValidate} className="gap-2">
                {runningValidate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Validar batch (persistir)
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Cada batch processa até 30 produtos presentes em ≥2 lojas. Resultados gravados em <code>tiny_fiscal_divergences</code>.
            </div>
          </CardContent>
        </Card>

        <Card className="opacity-60">
          <CardHeader><CardTitle>4. Revisão Manual</CardTitle><CardDescription>Próxima etapa: UI para revisar e resolver divergências.</CardDescription></CardHeader>
        </Card>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold text-foreground">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</div>
    </div>
  );
}
