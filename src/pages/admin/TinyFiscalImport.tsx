import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, PlayCircle, Database } from "lucide-react";
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
  const [lastDiscovery, setLastDiscovery] = useState<RunRow | null>(null);
  const [dedupCount, setDedupCount] = useState<number | null>(null);

  const loadStatus = async () => {
    const { data: runs } = await supabase
      .from("tiny_import_runs")
      .select("*")
      .eq("run_type", "discovery")
      .order("started_at", { ascending: false })
      .limit(1);
    setLastDiscovery((runs?.[0] as any) ?? null);

    const { count } = await supabase
      .from("product_dedup_index")
      .select("*", { count: "exact", head: true });
    setDedupCount(count ?? 0);
  };

  useEffect(() => { loadStatus(); }, []);

  const runDiscovery = async (mode: "dry_run" | "persist") => {
    setRunningDiscovery(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiny-discover-unique-products", {
        body: { mode },
      });
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

  const stats = lastDiscovery?.stats || {};

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
                <CardDescription>
                  Varre todas as lojas ativas e agrupa produtos por GTIN único.
                </CardDescription>
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
              <Stat label="pos_products lidos" value={stats.total_pos_products ?? "—"} />
              <Stat label="GTINs únicos" value={stats.unique_gtins ?? "—"} />
              <Stat label="Fallback (name+sku)" value={stats.fallback_name_sku ?? "—"} />
              <Stat label="Ignorados" value={stats.ignored_no_name_or_barcode ?? "—"} />
            </div>

            <div className="text-xs text-muted-foreground">
              {lastDiscovery
                ? <>Última execução: {new Date(lastDiscovery.started_at).toLocaleString("pt-BR")} • Persistidos no índice: <strong>{dedupCount ?? "..."}</strong></>
                : "Nenhuma execução ainda."}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => runDiscovery("dry_run")} disabled={runningDiscovery} variant="outline" className="gap-2">
                {runningDiscovery ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Rodar Discovery (dry-run)
              </Button>
              <Button onClick={() => runDiscovery("persist")} disabled={runningDiscovery} className="gap-2">
                {runningDiscovery ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Rodar Discovery (persistir)
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="opacity-60">
          <CardHeader>
            <CardTitle>2. Importação Fiscal</CardTitle>
            <CardDescription>Disponível após validar o Discovery.</CardDescription>
          </CardHeader>
        </Card>
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle>3. Cross-Validation</CardTitle>
            <CardDescription>Disponível após Importação.</CardDescription>
          </CardHeader>
        </Card>
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle>4. Revisão Manual</CardTitle>
            <CardDescription>Disponível após Importação.</CardDescription>
          </CardHeader>
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
