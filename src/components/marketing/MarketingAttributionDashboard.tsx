import { useState, useEffect } from "react";
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
import {
  DollarSign, Users, TrendingUp, Clock, RefreshCw, Target, Send,
  BarChart3, Loader2, Percent, Store, Repeat, ShoppingCart,
} from "lucide-react";

// ─── Types ───
interface CampaignResult {
  campaign: string;
  type: "lead_capture" | "mass_dispatch";
  leads_captured: number;
  leads_converted: number;
  conversion_rate: number;
  total_revenue: number;
  avg_ticket: number;
  avg_conversion_days: number;
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

  // Attribution state
  const [attrLoading, setAttrLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignResult[]>([]);
  const [filter, setFilter] = useState<"all" | "lead_capture" | "mass_dispatch">("all");

  // LTV state
  const [ltvLoading, setLtvLoading] = useState(false);
  const [ltvSummary, setLtvSummary] = useState<LtvSummary | null>(null);
  const [stores, setStores] = useState<StoreBreakdown[]>([]);
  const [freqDist, setFreqDist] = useState<Record<string, number>>({});
  const [ltvLoaded, setLtvLoaded] = useState(false);

  const fmt = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // ─── Fetch attribution ───
  const fetchAttribution = async () => {
    setAttrLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketing-attribution-dashboard");
      if (error) throw error;
      setSummary(data.summary);
      setCampaigns(data.campaigns || []);
    } catch (err) {
      console.error("Error fetching attribution:", err);
    } finally {
      setAttrLoading(false);
    }
  };

  // ─── Fetch LTV ───
  const fetchLtv = async () => {
    setLtvLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("marketing-ltv-dashboard");
      if (error) throw error;
      setLtvSummary(data.summary);
      setStores(data.stores || []);
      setFreqDist(data.frequency_distribution || {});
      setLtvLoaded(true);
    } catch (err) {
      console.error("Error fetching LTV:", err);
    } finally {
      setLtvLoading(false);
    }
  };

  useEffect(() => { fetchAttribution(); }, []);

  useEffect(() => {
    if (subTab === "ltv" && !ltvLoaded) fetchLtv();
  }, [subTab]);

  const filtered = filter === "all"
    ? campaigns
    : campaigns.filter((c) => c.type === filter);

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
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
          {attrLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Calculando atribuição de vendas...</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">
                    ROI por campanha de leads e disparos em massa (janela de 7 dias para clientes existentes)
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchAttribution} className="gap-1">
                  <RefreshCw className="h-3.5 w-3.5" />Atualizar
                </Button>
              </div>

              {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard icon={DollarSign} iconColor="text-emerald-500" label="Faturamento Atribuído" value={fmt(summary.overall_revenue)} valueColor="text-emerald-500" />
                  <StatCard icon={Target} iconColor="text-blue-500" label="Leads Captados" value={summary.total_leads.toLocaleString()}
                    sub={`${summary.total_leads_converted} convertidos → ${fmt(summary.total_lead_revenue)}`} />
                  <StatCard icon={Send} iconColor="text-violet-500" label="Disparos em Massa" value={summary.total_dispatches_sent.toLocaleString()}
                    sub={`${summary.total_dispatch_conversions} conversões → ${fmt(summary.total_dispatch_revenue)}`} />
                  <StatCard icon={Clock} iconColor="text-amber-500" label="Tempo Médio Conversão" value={`${summary.avg_conversion_days} dias`} />
                </div>
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
                        <TableHead className="text-right">Captados</TableHead>
                        <TableHead className="text-right">Convertidos</TableHead>
                        <TableHead className="text-right">Taxa Conv.</TableHead>
                        <TableHead className="text-right">Faturamento</TableHead>
                        <TableHead className="text-right">Ticket Médio</TableHead>
                        <TableHead className="text-right">Tempo Médio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium max-w-[200px] truncate">{c.campaign}</TableCell>
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
                          <TableCell className="text-right">{c.avg_ticket > 0 ? fmt(c.avg_ticket) : "—"}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{c.avg_conversion_days > 0 ? `${c.avg_conversion_days}d` : "—"}</TableCell>
                        </TableRow>
                      ))}
                      {filtered.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
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
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground font-medium">TOTAL ({filtered.length} campanhas)</span>
                      <div className="flex gap-6">
                        <MiniStat label="Captados" value={filtered.reduce((a, b) => a + b.leads_captured, 0).toLocaleString()} />
                        <MiniStat label="Convertidos" value={String(filtered.reduce((a, b) => a + b.leads_converted, 0))} color="text-emerald-500" />
                        <MiniStat label="Faturamento" value={fmt(filtered.reduce((a, b) => a + b.total_revenue, 0))} color="text-emerald-500" />
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
          {ltvLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Calculando LTV e recompra...</span>
            </div>
          ) : ltvSummary ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Lifetime Value, ticket médio e taxa de recompra com base em todas as vendas
                </p>
                <Button variant="outline" size="sm" onClick={fetchLtv} className="gap-1">
                  <RefreshCw className="h-3.5 w-3.5" />Atualizar
                </Button>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard icon={DollarSign} iconColor="text-emerald-500" label="LTV Médio" value={fmt(ltvSummary.ltv)} valueColor="text-emerald-500" />
                <StatCard icon={ShoppingCart} iconColor="text-blue-500" label="Ticket Médio" value={fmt(ltvSummary.avg_ticket)} />
                <StatCard icon={Repeat} iconColor="text-violet-500" label="Taxa de Recompra" value={`${ltvSummary.repeat_rate}%`}
                  sub={`${ltvSummary.repeat_customers} de ${ltvSummary.total_customers} clientes`} />
                <StatCard icon={Clock} iconColor="text-amber-500" label="Tempo p/ 2ª Compra" value={`${ltvSummary.avg_days_to_second_purchase} dias`} />
                <StatCard icon={Users} iconColor="text-cyan-500" label="Freq. Média" value={`${ltvSummary.avg_orders_per_customer}x`}
                  sub={`${ltvSummary.total_orders} pedidos / ${ltvSummary.total_customers} clientes`} />
              </div>

              {/* Frequency distribution */}
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

              {/* Per-store breakdown */}
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
      <p className={`font-bold ${color || ""}`}>{value}</p>
    </div>
  );
}
