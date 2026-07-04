import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, RefreshCw, Play, Package, DollarSign, TrendingUp, Boxes,
  AlertTriangle, CheckCircle2, Clock, Store as StoreIcon, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type RunRow = {
  id: string;
  status: "running" | "done" | "error" | string;
  per_store: any[] | null;
  totals: Record<string, number> | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

type StoreSnapshot = {
  store_id: string;
  store_name: string;
  skus: number;
  pairs: number;
  cost: number;
  sale: number;
};

const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number) => v.toLocaleString("pt-BR");

export function InventoryDashboard() {
  const [snapshot, setSnapshot] = useState<StoreSnapshot[]>([]);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [run, setRun] = useState<RunRow | null>(null);
  const [loadingRun, setLoadingRun] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [syncingIncremental, setSyncingIncremental] = useState(false);

  // ---- Snapshot ao vivo do banco (pos_products) ----
  const loadSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    const { data: stores } = await supabase
      .from("pos_stores")
      .select("id, name")
      .eq("has_tiny_token", true)
      .eq("is_active", true)
      .eq("is_simulation", false);

    if (!stores) {
      setSnapshot([]);
      setLoadingSnapshot(false);
      return;
    }

    const results: StoreSnapshot[] = [];
    for (const s of stores) {
      // Pagina pra calcular agregados sem estourar os 1000 do PostgREST
      let from = 0;
      const pageSize = 1000;
      let skus = 0;
      let pairs = 0;
      let cost = 0;
      let sale = 0;
      while (true) {
        const { data, error } = await supabase
          .from("pos_products")
          .select("stock, cost_price, price")
          .eq("store_id", s.id)
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        for (const p of data) {
          const stock = Number((p as any).stock ?? 0);
          const c = Number((p as any).cost_price ?? 0);
          const pr = Number((p as any).price ?? 0);
          skus += 1;
          if (stock > 0) {
            pairs += stock;
            cost += stock * c;
            sale += stock * pr;
          }
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      results.push({ store_id: s.id, store_name: s.name, skus, pairs, cost, sale });
    }
    setSnapshot(results);
    setLoadingSnapshot(false);
  }, []);

  // ---- Última run da auditoria ----
  const loadRun = useCallback(async () => {
    const { data } = await supabase
      .from("inventory_audit_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRun(data as unknown as RunRow);
    setLoadingRun(false);
  }, []);

  useEffect(() => {
    loadSnapshot();
    loadRun();
  }, [loadSnapshot, loadRun]);

  // Polling de progresso enquanto rodando
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const t = setInterval(loadRun, 5000);
    return () => clearInterval(t);
  }, [run?.status, loadRun]);

  // Realtime no pos_products pra dar refresh do snapshot quando o sync salvar dados
  useEffect(() => {
    const ch = supabase
      .channel("inventory-dashboard-products")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_products" },
        () => {
          // Throttle leve
          if (run?.status === "running") return; // já tem polling
          loadSnapshot();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [run?.status, loadSnapshot]);

  const handleTriggerAudit = async () => {
    if (!confirm("Disparar auditoria v2 do Tiny? Apenas atualiza produtos existentes (não cria novos). Pode levar ~30min.")) return;
    setTriggering(true);
    try {
      const { data, error } = await supabase.functions.invoke("inventory-audit-tiny", {
        body: { update_only: true },
      });
      if (error) throw error;
      toast.success("Auditoria v2 iniciada!");
      console.log("audit response", data);
      await loadRun();
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setTriggering(false);
    }
  };

  const handleIncrementalSync = async () => {
    setSyncingIncremental(true);
    try {
      const { data, error } = await supabase.functions.invoke("inventory-incremental-sync", {
        body: { days: 2 },
      });
      if (error) throw error;
      toast.success("Sync incremental disparado! Atualiza apenas SKUs movimentados nos últimos 2 dias (~5min).");
      console.log("incremental response", data);
      setTimeout(() => loadSnapshot(), 5000);
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    } finally {
      setSyncingIncremental(false);
    }
  };

  // ---- Cálculo de % verificado ----
  const perStore = (run?.per_store as any[]) || [];

  // Estágio 1: páginas escaneadas vs total. Não temos número_paginas final salvo,
  // então mostramos pages_scanned (aproximação) + skus_seen como métrica viva.
  const stage1Snapshot = perStore.map((s) => ({
    name: s.store_name,
    stage: s.stage as number,
    pages: s.pages_scanned ?? 0,
    seen: s.skus_seen ?? 0,
  }));

  const snapshotByStore = new Map(snapshot.map((item) => [item.store_id, item]));
  const totalSkusFromSnapshot = snapshot.reduce((a, b) => a + b.skus, 0);
  const stockProcessedTotal = perStore.reduce((total, store) => {
    const stage = Number(store.stage ?? 1);
    const storeSkus = snapshotByStore.get(store.store_id)?.skus ?? 0;
    const processed = Math.min(Number(store.stock_skus_processed) || 0, storeSkus);
    return total + (stage >= 2 || store.stock_finished ? processed : 0);
  }, 0);

  const catalogStoreCount = snapshot.length;
  const catalogFinishedCount = perStore.reduce(
    (count, store) => count + (store.catalog_finished ? 1 : 0),
    0,
  );
  const catalogPct = catalogStoreCount > 0 ? (catalogFinishedCount / catalogStoreCount) * 100 : 0;
  const stage2Pct = totalSkusFromSnapshot > 0 ? Math.min(100, (stockProcessedTotal / totalSkusFromSnapshot) * 100) : 0;

  const overallPct = run?.status === "done"
    ? 100
    : catalogPct < 100
      ? Math.round((catalogPct + stage2Pct) / 2)
      : Math.round(stage2Pct);

  // Totais consolidados (ao vivo, do banco)
  const totals = snapshot.reduce(
    (a, s) => ({
      skus: a.skus + s.skus,
      pairs: a.pairs + s.pairs,
      cost: a.cost + s.cost,
      sale: a.sale + s.sale,
    }),
    { skus: 0, pairs: 0, cost: 0, sale: 0 },
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dashboard de Estoque</h2>
          <p className="text-sm text-muted-foreground">
            Visão consolidada das 3 contas Tiny (Centro, Pérola e Site).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadSnapshot();
              loadRun();
            }}
            disabled={loadingSnapshot}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", loadingSnapshot && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs consolidados */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          label="SKUs cadastrados"
          value={fmtNum(totals.skus)}
          icon={<Package className="h-5 w-5" />}
          loading={loadingSnapshot}
        />
        <KpiCard
          label="Pares em estoque"
          value={fmtNum(totals.pairs)}
          icon={<Boxes className="h-5 w-5" />}
          loading={loadingSnapshot}
        />
        <KpiCard
          label="Custo total em estoque"
          value={fmtMoney(totals.cost)}
          icon={<DollarSign className="h-5 w-5" />}
          loading={loadingSnapshot}
        />
        <KpiCard
          label="Valor de venda em estoque"
          value={fmtMoney(totals.sale)}
          icon={<TrendingUp className="h-5 w-5" />}
          loading={loadingSnapshot}
        />
      </div>

      {/* Status da auditoria */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Status da última auditoria
            </span>
            {run && <RunStatusBadge status={run.status} />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRun ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : !run ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma auditoria registrada ainda. Dispare a auditoria v2 pra puxar os dados do Tiny.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Iniciada em {new Date(run.created_at).toLocaleString("pt-BR")}
                </span>
                {run.finished_at && (
                  <span className="text-muted-foreground">
                    Finalizada em {new Date(run.finished_at).toLocaleString("pt-BR")}
                  </span>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">% verificado no estoque</span>
                  <span className="text-sm font-bold">{overallPct}%</span>
                </div>
                <Progress value={overallPct} className="h-3" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Catálogo {Math.round(catalogPct)}% • Estoque {Math.round(stage2Pct)}% • {fmtNum(stockProcessedTotal)} de {fmtNum(totalSkusFromSnapshot)} SKUs processados no estágio 2.
                  </p>
              </div>

              {run.error_message && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                  <div>
                    <p className="font-medium text-destructive">Erro na auditoria</p>
                    <p className="text-muted-foreground">{run.error_message}</p>
                  </div>
                </div>
              )}

              {/* Per-store progress */}
              {perStore.length > 0 && (
                <div className="space-y-3 pt-2">
                  {perStore.map((s) => (
                    <div key={s.store_id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium flex items-center gap-2">
                          <StoreIcon className="h-4 w-4" /> {s.store_name}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          Estágio {s.stage}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <Metric label="Páginas" value={fmtNum(s.pages_scanned ?? 0)} />
                        <Metric label="SKUs vistos" value={fmtNum(s.skus_seen ?? 0)} />
                        <Metric label="SKUs atualizados" value={fmtNum(s.skus_updated ?? 0)} />
                        <Metric label="Estoque processado" value={fmtNum(s.stock_skus_processed ?? 0)} />
                      </div>
                      {(s.last_progress_at || s.last_error) && (
                        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                          {s.last_progress_at && <span>Último avanço: {new Date(s.last_progress_at).toLocaleString("pt-BR")}</span>}
                          {s.last_error && <span>Último aviso: {s.last_error}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabela por loja */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StoreIcon className="h-5 w-5" />
            Detalhamento por loja
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingSnapshot ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead className="text-right">SKUs</TableHead>
                  <TableHead className="text-right">Pares em estoque</TableHead>
                  <TableHead className="text-right">Custo em estoque</TableHead>
                  <TableHead className="text-right">Venda em estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.map((s) => (
                  <TableRow key={s.store_id}>
                    <TableCell className="font-medium">{s.store_name}</TableCell>
                    <TableCell className="text-right">{fmtNum(s.skus)}</TableCell>
                    <TableCell className="text-right">{fmtNum(s.pairs)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.cost)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.sale)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/40">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">{fmtNum(totals.skus)}</TableCell>
                  <TableCell className="text-right">{fmtNum(totals.pairs)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.cost)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.sale)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Em andamento
      </Badge>
    );
  }
  if (status === "done") {
    return (
      <Badge className="gap-1 bg-green-600 hover:bg-green-600">
        <CheckCircle2 className="h-3 w-3" /> Concluída
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Erro
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}
