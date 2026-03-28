import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  DollarSign, Users, TrendingUp, Clock, RefreshCw, Target, Send,
  BarChart3, Loader2, Percent, Store, Repeat, ShoppingCart, Calendar,
  Settings2, UserCheck, UserX, Megaphone,
} from "lucide-react";
import { format, subDays, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfYear, endOfYear, subWeeks, startOfQuarter, endOfQuarter } from "date-fns";

// ─── Period helpers ───
type PeriodKey = "all" | "7d" | "30d" | "quarter" | "semester" | "year" | "custom";

function getPeriodDates(period: PeriodKey): { from?: string; to?: string } {
  const now = new Date();
  switch (period) {
    case "7d": return { from: subDays(now, 7).toISOString(), to: now.toISOString() };
    case "30d": return { from: subDays(now, 30).toISOString(), to: now.toISOString() };
    case "quarter": return { from: startOfQuarter(now).toISOString(), to: endOfQuarter(now).toISOString() };
    case "semester": return { from: subMonths(now, 6).toISOString(), to: now.toISOString() };
    case "year": return { from: startOfYear(now).toISOString(), to: endOfYear(now).toISOString() };
    default: return {};
  }
}

// ─── Types ───
interface CampaignResult {
  campaign: string;
  template_name: string;
  type: "lead_capture" | "mass_dispatch";
  leads_captured: number;
  leads_converted: number;
  conversion_rate: number;
  total_revenue: number;
  avg_ticket: number;
  avg_conversion_days: number;
  leads_are_customers: number;
  leads_not_customers: number;
  dispatch_dates: string[];
  dispatch_count: number;
  total_messages_sent: number;
  template_category: string;
  total_cost: number;
  roas: number;
}

interface Summary {
  total_leads: number;
  total_leads_converted: number;
  total_lead_revenue: number;
  total_dispatches_sent: number;
  total_dispatch_conversions: number;
  total_dispatch_revenue: number;
  overall_revenue: number;
  avg_conversion_days: number;
  total_leads_are_customers: number;
  total_leads_not_customers: number;
  total_dispatch_cost: number;
  dispatch_roas: number;
  attribution_window_days: number;
}

interface LtvSummary {
  total_customers: number;
  total_orders: number;
  total_revenue: number;
  avg_ticket: number;
  ltv: number;
  repeat_rate: number;
  repeat_customers: number;
  avg_orders_per_customer: number;
  avg_days_to_second_purchase: number;
}

interface StoreBreakdown {
  store_id: string;
  store_name: string;
  total_customers: number;
  total_orders: number;
  total_revenue: number;
  avg_ticket: number;
  ltv: number;
  repeat_rate: number;
  repeat_customers: number;
  avg_days_to_second_purchase: number;
}

// ─── Component ───
export function MarketingAttributionDashboard() {
  const [subTab, setSubTab] = useState<"attribution" | "ltv">("attribution");

  // Shared period state
  const [attrPeriod, setAttrPeriod] = useState<PeriodKey>("all");
  const [attrCustomFrom, setAttrCustomFrom] = useState("");
  const [attrCustomTo, setAttrCustomTo] = useState("");
  const [ltvPeriod, setLtvPeriod] = useState<PeriodKey>("all");
  const [ltvCustomFrom, setLtvCustomFrom] = useState("");
  const [ltvCustomTo, setLtvCustomTo] = useState("");

  // Attribution window
  const [windowDays, setWindowDays] = useState(7);

  // Attribution state
  const [attrLoading, setAttrLoading] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignResult[]>([]);
  const [filter, setFilter] = useState<"all" | "lead_capture" | "mass_dispatch">("all");

  // LTV state
  const [ltvLoading, setLtvLoading] = useState(false);
  const [ltvSummary, setLtvSummary] = useState<LtvSummary | null>(null);
  const [stores, setStores] = useState<StoreBreakdown[]>([]);
  const [freqDist, setFreqDist] = useState<Record<string, number>>({});

  const fmt = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // ─── Fetch attribution ───
  const fetchAttribution = useCallback(async () => {
    setAttrLoading(true);
    try {
      let dateFrom: string | undefined;
      let dateTo: string | undefined;
      if (attrPeriod === "custom") {
        dateFrom = attrCustomFrom ? new Date(attrCustomFrom).toISOString() : undefined;
        dateTo = attrCustomTo ? new Date(attrCustomTo + "T23:59:59").toISOString() : undefined;
      } else if (attrPeriod !== "all") {
        const d = getPeriodDates(attrPeriod);
        dateFrom = d.from;
        dateTo = d.to;
      }
      const { data, error } = await supabase.functions.invoke("marketing-attribution-dashboard", {
        body: { date_from: dateFrom, date_to: dateTo, attribution_window_days: windowDays },
      });
      if (error) throw error;
      setSummary(data.summary);
      setCampaigns(data.campaigns || []);
    } catch (err) {
      console.error("Error fetching attribution:", err);
    } finally {
      setAttrLoading(false);
    }
  }, [attrPeriod, attrCustomFrom, attrCustomTo, windowDays]);

  // ─── Fetch LTV ───
  const fetchLtv = useCallback(async () => {
    setLtvLoading(true);
    try {
      let dateFrom: string | undefined;
      let dateTo: string | undefined;
      if (ltvPeriod === "custom") {
        dateFrom = ltvCustomFrom ? new Date(ltvCustomFrom).toISOString() : undefined;
        dateTo = ltvCustomTo ? new Date(ltvCustomTo + "T23:59:59").toISOString() : undefined;
      } else if (ltvPeriod !== "all") {
        const d = getPeriodDates(ltvPeriod);
        dateFrom = d.from;
        dateTo = d.to;
      }
      const { data, error } = await supabase.functions.invoke("marketing-ltv-dashboard", {
        body: { date_from: dateFrom, date_to: dateTo },
      });
      if (error) throw error;
      setLtvSummary(data.summary);
      setStores(data.stores || []);
      setFreqDist(data.frequency_distribution || {});
    } catch (err) {
      console.error("Error fetching LTV:", err);
    } finally {
      setLtvLoading(false);
    }
  }, [ltvPeriod, ltvCustomFrom, ltvCustomTo]);

  useEffect(() => { fetchAttribution(); }, []);
  useEffect(() => { if (subTab === "ltv") fetchLtv(); }, [subTab]);

  const filtered = filter === "all"
    ? campaigns
    : campaigns.filter((c) => c.type === filter);

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={(v) => setSubTab(v as any)}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="attribution" className="gap-1">
            <Target className="h-3.5 w-3.5" />Atribuição de Vendas
          </TabsTrigger>
          <TabsTrigger value="ltv" className="gap-1">
            <TrendingUp className="h-3.5 w-3.5" />LTV & Recompra
          </TabsTrigger>
        </TabsList>

        {/* ═══════ ATTRIBUTION TAB ═══════ */}
        <TabsContent value="attribution" className="space-y-4 mt-4">
          {/* Controls row */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[140px]">
              <label className="text-[10px] text-muted-foreground mb-1 block">Período</label>
              <Select value={attrPeriod} onValueChange={(v) => setAttrPeriod(v as PeriodKey)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todo o período</SelectItem>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="quarter">Trimestre atual</SelectItem>
                  <SelectItem value="semester">Últimos 6 meses</SelectItem>
                  <SelectItem value="year">Ano atual</SelectItem>
                  <SelectItem value="custom">Período livre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {attrPeriod === "custom" && (
              <>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">De</label>
                  <Input type="date" className="h-8 text-xs w-[140px]" value={attrCustomFrom} onChange={e => setAttrCustomFrom(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Até</label>
                  <Input type="date" className="h-8 text-xs w-[140px]" value={attrCustomTo} onChange={e => setAttrCustomTo(e.target.value)} />
                </div>
              </>
            )}
            <div className="min-w-[130px]">
              <label className="text-[10px] text-muted-foreground mb-1 block flex items-center gap-1">
                <Settings2 className="h-3 w-3" />Janela de atribuição
              </label>
              <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,4,5,7,10,14,21,30].map(d => (
                    <SelectItem key={d} value={String(d)}>{d} {d === 1 ? "dia" : "dias"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={fetchAttribution} className="gap-1 h-8">
              <RefreshCw className="h-3.5 w-3.5" />Atualizar
            </Button>
          </div>

          {attrLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Calculando atribuição de vendas...</span>
            </div>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground">
                ROI por campanha · janela de atribuição: {windowDays} {windowDays === 1 ? "dia" : "dias"}
              </p>

              {summary && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <StatCard icon={DollarSign} iconColor="text-emerald-500" label="Faturamento Atribuído" value={fmt(summary.overall_revenue)} valueColor="text-emerald-500" />
                    <StatCard icon={Target} iconColor="text-blue-500" label="Leads Captados" value={summary.total_leads.toLocaleString()}
                      sub={`${summary.total_leads_converted} convertidos → ${fmt(summary.total_lead_revenue)}`} />
                    <StatCard icon={Send} iconColor="text-violet-500" label="Disparos em Massa" value={summary.total_dispatches_sent.toLocaleString()}
                      sub={`${summary.total_dispatch_conversions} conversões → ${fmt(summary.total_dispatch_revenue)}`} />
                    <StatCard icon={Clock} iconColor="text-amber-500" label="Tempo Médio Conversão" value={`${summary.avg_conversion_days} dias`} />
                    <StatCard icon={Megaphone} iconColor="text-orange-500" label="ROAS Disparos" value={`${summary.dispatch_roas}x`}
                      sub={`Custo: ${fmt(summary.total_dispatch_cost)}`} valueColor={summary.dispatch_roas >= 1 ? "text-emerald-500" : "text-red-500"} />
                  </div>

                  {/* Leads breakdown */}
                  <div className="flex gap-3">
                    <Card className="flex-1">
                      <CardContent className="py-2 px-3 flex items-center gap-2">
                        <UserX className="h-4 w-4 text-blue-400" />
                        <div>
                          <p className="text-[10px] text-muted-foreground">Leads novos (não eram clientes)</p>
                          <p className="text-sm font-bold">{summary.total_leads_not_customers.toLocaleString()}</p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="flex-1">
                      <CardContent className="py-2 px-3 flex items-center gap-2">
                        <UserCheck className="h-4 w-4 text-emerald-400" />
                        <div>
                          <p className="text-[10px] text-muted-foreground">Leads que já eram clientes</p>
                          <p className="text-sm font-bold">{summary.total_leads_are_customers.toLocaleString()}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}

              <div className="flex gap-2">
                {(["all", "lead_capture", "mass_dispatch"] as const).map(f => (
                  <Button key={f} variant={filter === f ? "default" : "outline"} size="sm"
                    onClick={() => setFilter(f)} className="text-xs gap-1">
                    {f === "all" ? <BarChart3 className="h-3 w-3" /> : f === "lead_capture" ? <Target className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                    {f === "all" ? `Todas (${campaigns.length})` : f === "lead_capture"
                      ? `Leads (${campaigns.filter(c => c.type === "lead_capture").length})`
                      : `Disparos (${campaigns.filter(c => c.type === "mass_dispatch").length})`}
                  </Button>
                ))}
              </div>

              <Card>
                <ScrollArea className="max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campanha</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Enviados</TableHead>
                        <TableHead className="text-right">Convertidos</TableHead>
                        <TableHead className="text-right">Taxa Conv.</TableHead>
                        <TableHead className="text-right">Faturamento</TableHead>
                        <TableHead className="text-right">Custo</TableHead>
                        <TableHead className="text-right">ROAS</TableHead>
                        <TableHead className="text-right">Ticket Médio</TableHead>
                        <TableHead className="text-right">Disparos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium max-w-[200px]">
                            <div className="truncate">{c.campaign}</div>
                            {c.type === "mass_dispatch" && c.template_name && c.template_name !== c.campaign && (
                              <div className="text-[10px] text-muted-foreground font-mono">{c.template_name}</div>
                            )}
                            {c.type === "mass_dispatch" && c.dispatch_dates.length > 0 && (
                              <div className="text-[9px] text-muted-foreground mt-0.5">
                                {c.dispatch_dates.map(d => format(new Date(d), "dd/MM/yy HH:mm")).join(" · ")}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={
                              c.type === "lead_capture"
                                ? "bg-blue-500/10 text-blue-500 border-blue-500/30 text-[10px]"
                                : "bg-violet-500/10 text-violet-500 border-violet-500/30 text-[10px]"
                            }>
                              {c.type === "lead_capture" ? "Lead" : "Disparo"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{c.leads_captured.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <span className={c.leads_converted > 0 ? "text-emerald-500 font-medium" : ""}>{c.leads_converted}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={c.conversion_rate > 5 ? "text-emerald-500" : c.conversion_rate > 0 ? "text-amber-500" : "text-muted-foreground"}>
                              {c.conversion_rate}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-medium">{c.total_revenue > 0 ? fmt(c.total_revenue) : "—"}</TableCell>
                          <TableCell className="text-right text-muted-foreground text-xs">
                            {c.type === "mass_dispatch" && c.total_cost > 0 ? fmt(c.total_cost) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.type === "mass_dispatch" && c.roas > 0 ? (
                              <span className={c.roas >= 1 ? "text-emerald-500 font-medium" : "text-red-400"}>{c.roas}x</span>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-right">{c.avg_ticket > 0 ? fmt(c.avg_ticket) : "—"}</TableCell>
                          <TableCell className="text-right text-muted-foreground text-xs">
                            {c.type === "mass_dispatch" ? `${c.dispatch_count}x` : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                      {filtered.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                            <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                            Nenhuma campanha com dados de atribuição
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </Card>

              {filtered.length > 0 && (
                <Card>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                      <span className="text-muted-foreground font-medium">TOTAL ({filtered.length} campanhas)</span>
                      <div className="flex gap-6 flex-wrap">
                        <MiniStat label="Enviados" value={filtered.reduce((a, b) => a + b.leads_captured, 0).toLocaleString()} />
                        <MiniStat label="Convertidos" value={String(filtered.reduce((a, b) => a + b.leads_converted, 0))} color="text-emerald-500" />
                        <MiniStat label="Faturamento" value={fmt(filtered.reduce((a, b) => a + b.total_revenue, 0))} color="text-emerald-500" />
                        <MiniStat label="Custo" value={fmt(filtered.reduce((a, b) => a + b.total_cost, 0))} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ═══════ LTV TAB ═══════ */}
        <TabsContent value="ltv" className="space-y-4 mt-4">
          {/* Controls row */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[140px]">
              <label className="text-[10px] text-muted-foreground mb-1 block">Período</label>
              <Select value={ltvPeriod} onValueChange={(v) => setLtvPeriod(v as PeriodKey)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todo o período</SelectItem>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="quarter">Trimestre atual</SelectItem>
                  <SelectItem value="semester">Últimos 6 meses</SelectItem>
                  <SelectItem value="year">Ano atual</SelectItem>
                  <SelectItem value="custom">Período livre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ltvPeriod === "custom" && (
              <>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">De</label>
                  <Input type="date" className="h-8 text-xs w-[140px]" value={ltvCustomFrom} onChange={e => setLtvCustomFrom(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Até</label>
                  <Input type="date" className="h-8 text-xs w-[140px]" value={ltvCustomTo} onChange={e => setLtvCustomTo(e.target.value)} />
                </div>
              </>
            )}
            <Button variant="outline" size="sm" onClick={fetchLtv} className="gap-1 h-8">
              <RefreshCw className="h-3.5 w-3.5" />Atualizar
            </Button>
          </div>

          {ltvLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Calculando LTV e recompra...</span>
            </div>
          ) : ltvSummary ? (
            <>
              <p className="text-[10px] text-muted-foreground">
                Lifetime Value, ticket médio e taxa de recompra com base em todas as vendas
                {ltvPeriod !== "all" && " (período filtrado)"}
              </p>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard icon={DollarSign} iconColor="text-emerald-500" label="LTV Médio" value={fmt(ltvSummary.ltv)} valueColor="text-emerald-500" />
                <StatCard icon={ShoppingCart} iconColor="text-blue-500" label="Ticket Médio" value={fmt(ltvSummary.avg_ticket)} />
                <StatCard icon={Repeat} iconColor="text-violet-500" label="Taxa de Recompra" value={`${ltvSummary.repeat_rate}%`}
                  sub={`${ltvSummary.repeat_customers} de ${ltvSummary.total_customers} clientes`} />
                <StatCard icon={Clock} iconColor="text-amber-500" label="Tempo p/ 2ª Compra" value={`${ltvSummary.avg_days_to_second_purchase} dias`} />
                <StatCard icon={Users} iconColor="text-cyan-500" label="Freq. Média" value={`${ltvSummary.avg_orders_per_customer}x`}
                  sub={`${ltvSummary.total_orders} pedidos / ${ltvSummary.total_customers} clientes`} />
              </div>

              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs text-muted-foreground mb-3 font-medium">Distribuição de Frequência de Compra</p>
                  <div className="flex gap-2">
                    {Object.entries(freqDist).map(([label, count]) => {
                      const pct = ltvSummary.total_customers > 0 ? Math.round(count / ltvSummary.total_customers * 100) : 0;
                      return (
                        <div key={label} className="flex-1 text-center">
                          <div className="bg-primary/10 rounded-lg p-2 mb-1">
                            <p className="text-lg font-bold">{count}</p>
                            <p className="text-[10px] text-muted-foreground">{pct}%</p>
                          </div>
                          <p className="text-xs font-medium">{label}</p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 pb-2 px-4">
                  <p className="text-xs text-muted-foreground mb-3 font-medium flex items-center gap-1">
                    <Store className="h-3.5 w-3.5" />Análise por Canal de Venda
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Canal</TableHead>
                        <TableHead className="text-right">Clientes</TableHead>
                        <TableHead className="text-right">Pedidos</TableHead>
                        <TableHead className="text-right">Faturamento</TableHead>
                        <TableHead className="text-right">Ticket Médio</TableHead>
                        <TableHead className="text-right">LTV</TableHead>
                        <TableHead className="text-right">Recompra</TableHead>
                        <TableHead className="text-right">Tempo 2ª Compra</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stores.map(s => (
                        <TableRow key={s.store_id}>
                          <TableCell className="font-medium">{s.store_name}</TableCell>
                          <TableCell className="text-right">{s.total_customers}</TableCell>
                          <TableCell className="text-right">{s.total_orders}</TableCell>
                          <TableCell className="text-right font-medium">{fmt(s.total_revenue)}</TableCell>
                          <TableCell className="text-right">{fmt(s.avg_ticket)}</TableCell>
                          <TableCell className="text-right font-medium text-emerald-500">{fmt(s.ltv)}</TableCell>
                          <TableCell className="text-right">
                            <span className={s.repeat_rate > 10 ? "text-emerald-500" : s.repeat_rate > 0 ? "text-amber-500" : ""}>
                              {s.repeat_rate}%
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-1">({s.repeat_customers})</span>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {s.avg_days_to_second_purchase > 0 ? `${s.avg_days_to_second_purchase}d` : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Helper components ───
function StatCard({ icon: Icon, iconColor, label, value, valueColor, sub }: {
  icon: any; iconColor: string; label: string; value: string; valueColor?: string; sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        <p className={`text-xl font-bold ${valueColor || ""}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-right">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${color || ""}`}>{value}</p>
    </div>
  );
}
