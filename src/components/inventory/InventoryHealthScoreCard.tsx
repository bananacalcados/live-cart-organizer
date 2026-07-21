import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Activity, ChevronDown, ChevronUp, Info, Loader2, RefreshCw, TrendingUp, Package } from "lucide-react";
import { cn } from "@/lib/utils";

type Pillar = { key: string; label: string; weight: number; score: number };
type HealthResult = {
  horizon_days: number;
  store_id: string | null;
  pillars: Pillar[];
  overall: number;
  forecast_month_brl: number;
  total_stock_value: number;
  abc_summary: { a_count: number; b_count: number; c_count: number };
};

const HORIZONS = [
  { value: 30, label: "30 dias" },
  { value: 60, label: "60 dias" },
  { value: 90, label: "90 dias" },
];

const PILLAR_HINTS: Record<string, string> = {
  curve_a: "Dos produtos que geram ~80% do faturamento (Curva A), quanto da grade de tamanhos está disponível em estoque — ponderado pelo faturamento de cada produto.",
  curve_b: "Mesmo cálculo da Curva A, aplicado aos produtos de faixa intermediária (próximos 15% do faturamento).",
  size_weighted: "% da grade completa considerando o peso real de cada tamanho nas vendas do horizonte. Tamanho mais vendido pesa mais.",
  freshness: "% dos produtos que tiveram venda ou entrada de estoque nos últimos 60 dias. Menos = coleção parada.",
  turnover: "Sell-through: qty vendida em 30 dias ÷ estoque atual. 25% ao mês = nota 100.",
  stockout: "Quantos produtos das Curvas A/B estão com a grade incompleta neste momento. Menos rupturas = maior nota.",
};

const letterFor = (score: number) => {
  if (score >= 85) return { l: "A", tone: "text-emerald-500" };
  if (score >= 70) return { l: "B", tone: "text-blue-500" };
  if (score >= 55) return { l: "C", tone: "text-amber-500" };
  if (score >= 40) return { l: "D", tone: "text-orange-500" };
  return { l: "E", tone: "text-red-500" };
};

const barTone = (score: number) =>
  score >= 70 ? "bg-emerald-500" :
  score >= 55 ? "bg-blue-500" :
  score >= 40 ? "bg-amber-500" : "bg-red-500";

const fmtMoney = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function InventoryHealthScoreCard({ storeId }: { storeId: string | null }) {
  const [horizon, setHorizon] = useState<number>(60);
  const [data, setData] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [cached, setCached] = useState<boolean>(false);

  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.functions.invoke("calculate-inventory-health", {
      body: { horizon_days: horizon, store_id: storeId, force },
    });
    if (err) setError(err.message);
    else if ((res as any)?.error) setError((res as any).error);
    else {
      setData(res as unknown as HealthResult);
      setComputedAt((res as any)?.computed_at ?? null);
      setCached(Boolean((res as any)?.cached));
    }
    setLoading(false);
  };

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon, storeId]);

  const grade = useMemo(() => letterFor(data?.overall ?? 0), [data?.overall]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Score card */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" /> Saúde consolidada do estoque
              </CardTitle>
              <div className="flex items-center gap-2">
                <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HORIZONS.map(h => (
                      <SelectItem key={h.value} value={String(h.value)}>Curva ABC · {h.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading} className="h-8">
                  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading && !data ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Calculando saúde do estoque...
              </div>
            ) : error ? (
              <div className="text-sm text-red-500">Erro: {error}</div>
            ) : data ? (
              <>
                <div className="flex items-center gap-6 mb-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-bold tabular-nums">{data.overall.toFixed(0)}</span>
                    <span className="text-lg text-muted-foreground">/100</span>
                  </div>
                  <div className={cn("text-4xl font-bold", grade.tone)}>{grade.l}</div>
                  <div className="flex-1">
                    <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full transition-all", barTone(data.overall))}
                        style={{ width: `${Math.max(0, Math.min(100, data.overall))}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Horizonte {data.horizon_days}d · Curva A: {data.abc_summary.a_count} · B: {data.abc_summary.b_count} · C: {data.abc_summary.c_count}
                    </div>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded(v => !v)}
                  className="w-full h-8 -mx-1"
                >
                  {expanded ? <><ChevronUp className="h-4 w-4 mr-1" /> Ocultar pilares</> : <><ChevronDown className="h-4 w-4 mr-1" /> Ver pilares</>}
                </Button>

                {expanded && (
                  <div className="mt-3 space-y-3">
                    {data.pillars.map(p => (
                      <div key={p.key} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{p.label}</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="text-muted-foreground hover:text-foreground">
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                {PILLAR_HINTS[p.key] || p.label}
                              </TooltipContent>
                            </Tooltip>
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 ml-1">peso {p.weight}%</Badge>
                          </div>
                          <span className="font-semibold tabular-nums">{p.score.toFixed(0)}</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn("h-full transition-all", barTone(p.score))}
                            style={{ width: `${Math.max(0, Math.min(100, p.score))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Forecast card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Previsão de faturamento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data ? (
              <>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Projeção mês (baseado nos últimos {data.horizon_days}d)</div>
                  <div className="text-3xl font-bold text-emerald-500">{fmtMoney(data.forecast_month_brl)}</div>
                </div>
                <div className="pt-3 border-t">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Package className="h-3 w-3" /> Valor total em estoque
                  </div>
                  <div className="text-xl font-semibold">{fmtMoney(data.total_stock_value)}</div>
                </div>
              </>
            ) : loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
