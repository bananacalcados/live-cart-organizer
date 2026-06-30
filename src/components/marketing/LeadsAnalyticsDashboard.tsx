import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, TrendingUp, Users, ShoppingBag, DollarSign, Repeat,
  UserCheck, Sparkles, BarChart3, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

type Summary = {
  leads_in_scope: number;
  leads_converted: number;
  conversion_rate: number;
  were_customers_before: number;
  first_time_buyers: number;
  total_purchases: number;
  total_revenue: number;
  avg_ticket: number;
  avg_purchases_per_lead: number;
};

type DashboardData = {
  mode: string;
  first_purchase_only: boolean;
  summary: Summary;
  channels: { channel: string; purchases: number; revenue: number; leads: number }[];
  sources: { source: string; leads: number; converted: number; purchases: number; revenue: number; conversion_rate: number }[];
  months: { month: string; purchases: number; revenue: number }[];
};

type Mode = "captured" | "purchased";
type PeriodPreset = "month" | "quarter" | "semester" | "year" | "custom";

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function computeRange(preset: PeriodPreset, customFrom: string, customTo: string) {
  const now = new Date();
  let from: Date;
  let to: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  switch (preset) {
    case "month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      from = new Date(now.getFullYear(), q * 3, 1);
      break;
    }
    case "semester": {
      const half = now.getMonth() < 6 ? 0 : 6;
      from = new Date(now.getFullYear(), half, 1);
      break;
    }
    case "year":
      from = new Date(now.getFullYear(), 0, 1);
      break;
    case "custom":
      from = customFrom ? new Date(customFrom + "T00:00:00") : new Date(now.getFullYear(), 0, 1);
      to = customTo ? new Date(customTo + "T23:59:59") : to;
      break;
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTH_LABELS[Number(m) - 1]}/${y.slice(2)}`;
}

export function LeadsAnalyticsDashboard() {
  const [mode, setMode] = useState<Mode>("captured");
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [firstPurchaseOnly, setFirstPurchaseOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = computeRange(preset, customFrom, customTo);
      const { data: res, error } = await supabase.functions.invoke("marketing-leads-dashboard", {
        body: { mode, date_from: from, date_to: to, first_purchase_only: firstPurchaseOnly },
      });
      if (error) throw error;
      if ((res as any)?.error) throw new Error((res as any).error);
      setData(res as DashboardData);
    } catch (e: any) {
      toast.error("Erro ao carregar dashboard: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [mode, preset, customFrom, customTo, firstPurchaseOnly]);

  // Reload on mount and whenever the mode toggle changes (period/filters use "Aplicar")
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const s = data?.summary;
  const maxMonthRev = Math.max(1, ...(data?.months || []).map(m => m.revenue));

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-5 w-5 text-primary" />
          Análise de Conversão de Leads
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode toggle */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={mode === "captured" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("captured")}
          >
            🎯 Leads captados no período
          </Button>
          <Button
            variant={mode === "purchased" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("purchased")}
          >
            🛒 Todos os leads que compraram no período
          </Button>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          {mode === "captured"
            ? "Considera os leads CAPTADOS (1ª vez) dentro do período selecionado e quantos deles compraram."
            : "Considera TODOS os leads cadastrados (desde o início) e verifica quais COMPRARAM dentro do período selecionado."}
        </p>

        {/* Period + filters */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Período</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
              <SelectTrigger className="w-[170px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Este mês</SelectItem>
                <SelectItem value="quarter">Este trimestre</SelectItem>
                <SelectItem value="semester">Este semestre</SelectItem>
                <SelectItem value="year">Este ano</SelectItem>
                <SelectItem value="custom">Período específico</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">De</Label>
                <Input type="date" className="h-9 w-[150px]" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Até</Label>
                <Input type="date" className="h-9 w-[150px]" value={customTo} onChange={e => setCustomTo(e.target.value)} />
              </div>
            </>
          )}
          <div className="flex items-center gap-2 h-9 px-3 rounded-md border">
            <Switch id="first-purchase" checked={firstPurchaseOnly} onCheckedChange={setFirstPurchaseOnly} />
            <Label htmlFor="first-purchase" className="text-xs cursor-pointer">Apenas 1ª compra</Label>
          </div>
          <Button size="sm" onClick={load} disabled={loading} className="gap-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Aplicar
          </Button>
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : s ? (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={<Users className="h-4 w-4" />} label={mode === "captured" ? "Leads captados" : "Leads que compraram"} value={s.leads_in_scope.toLocaleString("pt-BR")} />
              <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Leads convertidos" value={s.leads_converted.toLocaleString("pt-BR")} sub={`${s.conversion_rate}% de conversão`} accent="emerald" />
              <KpiCard icon={<ShoppingBag className="h-4 w-4" />} label="Compras realizadas" value={s.total_purchases.toLocaleString("pt-BR")} sub={`${s.avg_purchases_per_lead} por lead`} />
              <KpiCard icon={<DollarSign className="h-4 w-4" />} label="Valor total convertido" value={fmtBRL(s.total_revenue)} sub={`Ticket ${fmtBRL(s.avg_ticket)}`} accent="emerald" />
              <KpiCard icon={<UserCheck className="h-4 w-4" />} label="Já eram clientes antes" value={s.were_customers_before.toLocaleString("pt-BR")} sub="compraram antes de virar lead" accent="amber" />
              <KpiCard icon={<Sparkles className="h-4 w-4" />} label="1ª compra (novos)" value={s.first_time_buyers.toLocaleString("pt-BR")} sub="converteram pela 1ª vez" accent="violet" />
              <KpiCard icon={<Repeat className="h-4 w-4" />} label="Ticket médio" value={fmtBRL(s.avg_ticket)} />
              <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Taxa de conversão" value={`${s.conversion_rate}%`} accent="emerald" />
            </div>

            {/* Channels */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                  <ShoppingBag className="h-4 w-4 text-primary" /> Canal de conversão
                </h4>
                <div className="space-y-1.5">
                  {data!.channels.length === 0 && <p className="text-xs text-muted-foreground">Sem conversões no período.</p>}
                  {data!.channels.map(c => {
                    const pct = s.total_revenue > 0 ? (c.revenue / s.total_revenue) * 100 : 0;
                    return (
                      <div key={c.channel} className="text-xs">
                        <div className="flex justify-between mb-0.5">
                          <span className="font-medium">{c.channel}</span>
                          <span className="text-muted-foreground">{fmtBRL(c.revenue)} · {c.purchases} compras</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Monthly trend */}
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                  <BarChart3 className="h-4 w-4 text-primary" /> Receita por mês (das compras)
                </h4>
                <div className="flex items-end gap-1 h-28 border-b border-l pl-1 pb-0">
                  {data!.months.length === 0 && <p className="text-xs text-muted-foreground self-center">Sem dados.</p>}
                  {data!.months.map(m => (
                    <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full" title={`${monthLabel(m.month)}: ${fmtBRL(m.revenue)}`}>
                      <div className="w-full bg-emerald-500/80 rounded-t" style={{ height: `${(m.revenue / maxMonthRev) * 100}%` }} />
                      <span className="text-[9px] text-muted-foreground mt-0.5 rotate-0">{monthLabel(m.month)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sources table */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Conversão por canal de captação</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-1.5 pr-2">Origem do lead</th>
                      <th className="py-1.5 px-2 text-right">Leads</th>
                      <th className="py-1.5 px-2 text-right">Convertidos</th>
                      <th className="py-1.5 px-2 text-right">Taxa</th>
                      <th className="py-1.5 px-2 text-right">Compras</th>
                      <th className="py-1.5 pl-2 text-right">Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.sources.map(src => (
                      <tr key={src.source} className="border-b last:border-0">
                        <td className="py-1.5 pr-2 font-medium">{src.source}</td>
                        <td className="py-1.5 px-2 text-right">{src.leads}</td>
                        <td className="py-1.5 px-2 text-right">{src.converted}</td>
                        <td className="py-1.5 px-2 text-right">
                          <Badge variant="outline" className="text-[10px]">{src.conversion_rate}%</Badge>
                        </td>
                        <td className="py-1.5 px-2 text-right">{src.purchases}</td>
                        <td className="py-1.5 pl-2 text-right font-semibold">{fmtBRL(src.revenue)}</td>
                      </tr>
                    ))}
                    {data!.sources.length === 0 && (
                      <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Sem dados no período.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function KpiCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  accent?: "emerald" | "amber" | "violet";
}) {
  const accentCls =
    accent === "emerald" ? "text-emerald-600 dark:text-emerald-400"
      : accent === "amber" ? "text-amber-600 dark:text-amber-400"
        : accent === "violet" ? "text-violet-600 dark:text-violet-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[11px] mb-1">
        {icon}<span>{label}</span>
      </div>
      <div className={`text-lg font-bold leading-tight ${accentCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
