import { useEffect, useState, useMemo } from "react";
import { ArrowLeft, Store, TrendingUp, ShoppingBag, DollarSign, Package, Target, Loader2, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, startOfMonth, startOfDay, startOfWeek, endOfDay, differenceInDays, isAfter, isBefore } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  onBack: () => void;
}

type Period = "today" | "week" | "month";

interface StoreData {
  id: string;
  name: string;
  revenue: number;
  sales: number;
  items: number;
  ticket: number;
  itemsPerSale: number;
}

interface GoalRow {
  store_id: string;
  goal_value: number;
  period: string;
  period_start: string | null;
  period_end: string | null;
  goal_type: string;
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function POSGeneralDashboard({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [period, setPeriod] = useState<Period>("month");
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [salesRows, setSalesRows] = useState<any[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);

  const periodRange = useMemo(() => {
    const now = new Date();
    if (period === "today") return { start: startOfDay(now), end: endOfDay(now), label: "Hoje", days: 1 };
    if (period === "week") return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfDay(now), label: "Semana", days: 7 };
    const s = startOfMonth(now);
    return { start: s, end: endOfDay(now), label: "Mês", days: differenceInDays(endOfDay(now), s) + 1 };
  }, [period]);

  const load = async () => {
    setLoading(true);
    try {
      const [storesRes, salesRes, itemsRes, goalsRes] = await Promise.all([
        supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name"),
        supabase.from("pos_sales").select("id, store_id, total, created_at, status")
          .gte("created_at", periodRange.start.toISOString())
          .lte("created_at", periodRange.end.toISOString())
          .neq("status", "cancelled")
          .limit(10000),
        supabase.from("pos_sale_items").select("sale_id, quantity").limit(50000),
        supabase.from("pos_goals").select("store_id, goal_value, period, period_start, period_end, goal_type").eq("is_active", true),
      ]);
      setStores(storesRes.data || []);
      const sales = salesRes.data || [];
      const itemsMap = new Map<string, number>();
      for (const it of (itemsRes.data || [])) {
        itemsMap.set(it.sale_id, (itemsMap.get(it.sale_id) || 0) + Number(it.quantity || 0));
      }
      setSalesRows(sales.map((s: any) => ({ ...s, items: itemsMap.get(s.id) || 0 })));
      setGoals((goalsRes.data || []) as any);
    } catch (e: any) {
      toast.error("Erro ao carregar: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [period]);

  const storeData: StoreData[] = useMemo(() => {
    return stores.map(s => {
      const rows = salesRows.filter(r => r.store_id === s.id);
      const revenue = rows.reduce((a, r) => a + Number(r.total || 0), 0);
      const sales = rows.length;
      const items = rows.reduce((a, r) => a + Number(r.items || 0), 0);
      return {
        id: s.id, name: s.name, revenue, sales, items,
        ticket: sales > 0 ? revenue / sales : 0,
        itemsPerSale: sales > 0 ? items / sales : 0,
      };
    });
  }, [stores, salesRows]);

  const totals = useMemo(() => {
    const revenue = storeData.reduce((a, s) => a + s.revenue, 0);
    const sales = storeData.reduce((a, s) => a + s.sales, 0);
    const items = storeData.reduce((a, s) => a + s.items, 0);
    return {
      revenue, sales, items,
      ticket: sales > 0 ? revenue / sales : 0,
      itemsPerSale: sales > 0 ? items / sales : 0,
    };
  }, [storeData]);

  // Goals (revenue type), aggregate matching current period
  const goalData = useMemo(() => {
    const now = new Date();
    const matching = goals.filter(g => {
      if (g.goal_type !== "revenue") return false;
      if (g.period_start && g.period_end) {
        return !isBefore(now, new Date(g.period_start)) && !isAfter(now, new Date(g.period_end));
      }
      // map period
      if (period === "month" && g.period === "monthly") return true;
      if (period === "week" && g.period === "weekly") return true;
      if (period === "today" && g.period === "daily") return true;
      return false;
    });
    const byStore = new Map<string, number>();
    for (const g of matching) byStore.set(g.store_id, (byStore.get(g.store_id) || 0) + Number(g.goal_value || 0));
    const total = Array.from(byStore.values()).reduce((a, b) => a + b, 0);
    const dayOfPeriod = period === "month" ? new Date().getDate() : period === "week" ? differenceInDays(now, periodRange.start) + 1 : 1;
    const expected = total > 0 ? (total / periodRange.days) * dayOfPeriod : 0;
    return { byStore, total, expected };
  }, [goals, period, periodRange]);

  const handleSyncShopify = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-sync-to-pos", { body: { days: 365 } });
      if (error) throw error;
      toast.success(`Sincronizado: ${data?.inserted || 0} vendas importadas, ${data?.skipped || 0} já existiam`);
      await load();
    } catch (e: any) {
      toast.error("Erro ao sincronizar: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[hsl(var(--pos-bg))] text-foreground">
      <div className="px-4 py-3 border-b border-border bg-white flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-orange-500" />
            Dashboard Geral — Todas as Lojas
          </h2>
          <p className="text-xs text-muted-foreground">Visão consolidada de faturamento, vendas e metas</p>
        </div>
        <Select value={period} onValueChange={v => setPeriod(v as Period)}>
          <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Semana</SelectItem>
            <SelectItem value="month">Mês</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleSyncShopify} disabled={syncing} className="gap-2 border-orange-400 text-orange-600 hover:bg-orange-50">
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Sincronizar Shopify
        </Button>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label="Faturamento total" value={BRL(totals.revenue)} icon={DollarSign} color="text-emerald-600" />
            <Kpi label="Nº de vendas" value={totals.sales} icon={ShoppingBag} color="text-orange-600" />
            <Kpi label="Itens vendidos" value={totals.items} icon={Package} color="text-blue-600" />
            <Kpi label="Ticket médio" value={BRL(totals.ticket)} icon={DollarSign} color="text-fuchsia-600" />
            <Kpi label="Itens / venda" value={totals.itemsPerSale.toFixed(2)} icon={Package} color="text-indigo-600" />
          </div>

          {/* Goals */}
          {goalData.total > 0 && (
            <div className="bg-white border border-border rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-orange-500" />
                <h3 className="text-sm font-bold">Meta consolidada — {periodRange.label}</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <GoalBox label="Meta total" value={BRL(goalData.total)} />
                <GoalBox label="Esperado até hoje" value={BRL(goalData.expected)} sub={`${((goalData.expected / goalData.total) * 100).toFixed(0)}% da meta`} />
                <GoalBox
                  label="Realizado"
                  value={BRL(totals.revenue)}
                  sub={`${goalData.total > 0 ? ((totals.revenue / goalData.total) * 100).toFixed(1) : 0}% da meta`}
                  highlight={totals.revenue >= goalData.expected ? "ahead" : "behind"}
                />
              </div>
              <div className="mt-4">
                <Progress value={Math.min(100, (totals.revenue / goalData.total) * 100)} className="h-2" />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Progresso da meta total — esperado neste ponto do período: {BRL(goalData.expected)}
                </p>
              </div>
            </div>
          )}

          {/* Per store */}
          <div className="bg-white border border-border rounded-xl p-4 shadow-sm">
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <Store className="h-4 w-4 text-orange-500" /> Detalhamento por Loja
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
              </div>
            ) : storeData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma loja ativa</p>
            ) : (
              <div className="space-y-3">
                {storeData.map(s => {
                  const goal = goalData.byStore.get(s.id) || 0;
                  const pct = goal > 0 ? Math.min(100, (s.revenue / goal) * 100) : 0;
                  return (
                    <div key={s.id} className="border border-border rounded-lg p-3 bg-[hsl(var(--pos-bg-2))]">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-orange-100 text-orange-600">
                          <Store className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold">{s.name}</h4>
                          <p className="text-[11px] text-muted-foreground">{s.sales} vendas · {s.items} itens</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-emerald-600">{BRL(s.revenue)}</p>
                          {goal > 0 && (
                            <Badge variant="outline" className="text-[10px]">
                              {pct.toFixed(0)}% da meta · {BRL(goal)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px] mt-2">
                        <div className="text-center bg-white rounded p-1.5 border border-border">
                          <p className="text-muted-foreground">Ticket</p>
                          <p className="font-bold text-foreground">{BRL(s.ticket)}</p>
                        </div>
                        <div className="text-center bg-white rounded p-1.5 border border-border">
                          <p className="text-muted-foreground">Itens/venda</p>
                          <p className="font-bold text-foreground">{s.itemsPerSale.toFixed(2)}</p>
                        </div>
                        <div className="text-center bg-white rounded p-1.5 border border-border">
                          <p className="text-muted-foreground">% do total</p>
                          <p className="font-bold text-foreground">{totals.revenue > 0 ? ((s.revenue / totals.revenue) * 100).toFixed(1) : 0}%</p>
                        </div>
                      </div>
                      {goal > 0 && <Progress value={pct} className="h-1.5 mt-2" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, color }: { label: string; value: any; icon: any; color: string }) {
  return (
    <div className="bg-white border border-border rounded-lg p-3 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function GoalBox({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "ahead" | "behind" }) {
  const color = highlight === "ahead" ? "text-emerald-600" : highlight === "behind" ? "text-amber-600" : "text-foreground";
  return (
    <div className="bg-[hsl(var(--pos-bg-2))] border border-border rounded-lg p-3">
      <p className="text-[10px] uppercase font-semibold text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
