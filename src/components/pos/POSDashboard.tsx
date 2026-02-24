import { useState, useEffect } from "react";
import {
  DollarSign, ShoppingCart, TrendingUp, Package, Loader2,
  RefreshCw, BarChart3, Users, MessageSquare, Headphones,
  ArrowRightLeft, ChevronRight, CalendarIcon
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";

interface Props {
  storeId: string;
  onNavigateToSection: (section: string) => void;
}

type Period = "day" | "week" | "month" | "custom";

interface SellerMetric {
  name: string;
  totalSales: number;
  salesCount: number;
  totalItems: number;
}

function getPeriodRange(period: Period, customRange: DateRange | undefined): { start: Date; end: Date } {
  if (period === "custom" && customRange?.from) {
    const start = new Date(customRange.from);
    start.setHours(0, 0, 0, 0);
    const end = customRange.to ? new Date(customRange.to) : new Date(customRange.from);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === "week") {
    start.setDate(start.getDate() - 6);
  } else if (period === "month") {
    start.setDate(start.getDate() - 29);
  }
  return { start, end };
}

export function POSDashboard({ storeId, onNavigateToSection }: Props) {
  const [period, setPeriod] = useState<Period>("day");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [loading, setLoading] = useState(true);

  // KPIs
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [avgTicket, setAvgTicket] = useState(0);
  const [avgItemsPerSale, setAvgItemsPerSale] = useState(0);

  // Seller metrics
  const [sellerMetrics, setSellerMetrics] = useState<SellerMetric[]>([]);

  // Alerts
  const [whatsappAwaiting, setWhatsappAwaiting] = useState(0);
  const [whatsappNew, setWhatsappNew] = useState(0);
  const [supportTickets, setSupportTickets] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);

  const loadAlerts = async () => {
    const [conversationRes, supportRes, interStoreRes, stockRes] = await Promise.all([
      supabase.rpc("get_conversation_counts"),
      supabase
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .in("status", ["new", "in_progress"]),
      supabase
        .from("pos_inter_store_requests")
        .select("id", { count: "exact", head: true })
        .eq("to_store_id", storeId)
        .eq("status", "pending"),
      supabase
        .from("expedition_stock_requests")
        .select("id", { count: "exact", head: true })
        .eq("to_store_id", storeId)
        .eq("status", "pending"),
    ]);

    if (conversationRes.data && conversationRes.data.length > 0) {
      const d = conversationRes.data[0];
      setWhatsappAwaiting(Number(d.awaiting_count) || 0);
      setWhatsappNew(Number(d.new_count) || 0);
    }
    setSupportTickets(supportRes.count || 0);
    setPendingRequests((interStoreRes.count || 0) + (stockRes.count || 0));
  };

  const loadSalesData = async () => {
    setLoading(true);
    try {
      const { start, end } = getPeriodRange(period, customRange);

      const { data: sales } = await supabase
        .from("pos_sales")
        .select("id, total, seller_id, status")
        .eq("store_id", storeId)
        .eq("status", "completed")
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString());

      const completedSales = sales || [];
      const revenue = completedSales.reduce((s, sale) => s + (sale.total || 0), 0);
      const count = completedSales.length;

      setTotalRevenue(revenue);
      setSalesCount(count);
      setAvgTicket(count > 0 ? revenue / count : 0);

      if (completedSales.length > 0) {
        const saleIds = completedSales.map((s) => s.id);
        const { data: items } = await supabase
          .from("pos_sale_items")
          .select("sale_id, quantity")
          .in("sale_id", saleIds);

        const totalItems = (items || []).reduce((s, i) => s + (i.quantity || 0), 0);
        setAvgItemsPerSale(count > 0 ? totalItems / count : 0);

        const { data: sellersData } = await supabase
          .from("pos_sellers")
          .select("id, name")
          .eq("store_id", storeId);

        const sellersMap = new Map((sellersData || []).map((s) => [s.id, s.name]));
        const metricsMap = new Map<string, SellerMetric>();

        const saleItemsMap = new Map<string, number>();
        for (const item of items || []) {
          saleItemsMap.set(item.sale_id, (saleItemsMap.get(item.sale_id) || 0) + (item.quantity || 0));
        }

        for (const sale of completedSales) {
          const key = sale.seller_id || "sem-vendedor";
          const name = sellersMap.get(sale.seller_id || "") || "Sem vendedor";
          const existing = metricsMap.get(key) || { name, totalSales: 0, salesCount: 0, totalItems: 0 };
          existing.totalSales += sale.total || 0;
          existing.salesCount += 1;
          existing.totalItems += saleItemsMap.get(sale.id) || 0;
          metricsMap.set(key, existing);
        }

        setSellerMetrics(Array.from(metricsMap.values()).sort((a, b) => b.totalSales - a.totalSales));
      } else {
        setAvgItemsPerSale(0);
        setSellerMetrics([]);
      }
    } catch (e) {
      console.error("Dashboard load error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (period === "custom" && !customRange?.from) return;
    loadSalesData();
  }, [storeId, period, customRange]);

  useEffect(() => {
    loadAlerts();
  }, [storeId]);

  const handlePeriodChange = (v: string) => {
    if (!v) return;
    if (v !== "custom") {
      setCustomRange(undefined);
    }
    setPeriod(v as Period);
  };

  const periodLabel = period === "day"
    ? "Hoje"
    : period === "week"
    ? "Semana"
    : period === "month"
    ? "Mês"
    : customRange?.from
    ? `${format(customRange.from, "dd/MM", { locale: ptBR })}${customRange.to ? ` - ${format(customRange.to, "dd/MM", { locale: ptBR })}` : ""}`
    : "Personalizado";

  const totalAlerts = whatsappAwaiting + whatsappNew + supportTickets + pendingRequests;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-pos-orange/20 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-pos-orange" />
          <h2 className="text-lg font-bold text-pos-white">Dashboard</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ToggleGroup
            type="single"
            value={period}
            onValueChange={handlePeriodChange}
            className="bg-pos-white/5 rounded-lg p-0.5"
          >
            <ToggleGroupItem value="day" className="text-xs px-3 py-1 data-[state=on]:bg-pos-orange data-[state=on]:text-pos-black text-pos-white/60 rounded-md">
              Dia
            </ToggleGroupItem>
            <ToggleGroupItem value="week" className="text-xs px-3 py-1 data-[state=on]:bg-pos-orange data-[state=on]:text-pos-black text-pos-white/60 rounded-md">
              Semana
            </ToggleGroupItem>
            <ToggleGroupItem value="month" className="text-xs px-3 py-1 data-[state=on]:bg-pos-orange data-[state=on]:text-pos-black text-pos-white/60 rounded-md">
              Mês
            </ToggleGroupItem>
            <ToggleGroupItem value="custom" className="text-xs px-3 py-1 data-[state=on]:bg-pos-orange data-[state=on]:text-pos-black text-pos-white/60 rounded-md">
              <CalendarIcon className="h-3.5 w-3.5 mr-1" />
              Período
            </ToggleGroupItem>
          </ToggleGroup>

          {period === "custom" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 text-xs">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {customRange?.from
                    ? `${format(customRange.from, "dd/MM")}${customRange.to ? ` - ${format(customRange.to, "dd/MM")}` : ""}`
                    : "Selecionar datas"
                  }
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={customRange}
                  onSelect={setCustomRange}
                  disabled={(date) => date > new Date()}
                  locale={ptBR}
                  numberOfMonths={2}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          )}

          <Button variant="outline" size="sm" className="gap-1 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10" onClick={() => { loadSalesData(); loadAlerts(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-pos-white/50">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando dashboard...
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KPICard icon={DollarSign} label="Faturamento" value={`R$ ${totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} sub={periodLabel} color="text-green-400" />
              <KPICard icon={ShoppingCart} label="Vendas" value={String(salesCount)} sub={periodLabel} color="text-pos-orange" />
              <KPICard icon={TrendingUp} label="Ticket Médio" value={`R$ ${avgTicket.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} sub={periodLabel} color="text-blue-400" />
              <KPICard icon={Package} label="Itens/Venda" value={avgItemsPerSale.toFixed(1)} sub={periodLabel} color="text-purple-400" />
            </div>

            {/* Seller Metrics */}
            {sellerMetrics.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
                  <Users className="h-4 w-4 text-pos-orange" /> Desempenho por Vendedor
                </h3>
                <div className="space-y-2">
                  {sellerMetrics.map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-pos-orange/20 flex items-center justify-center text-xs font-bold text-pos-orange">
                          {i + 1}º
                        </div>
                        <div>
                          <p className="font-medium text-sm text-pos-white">{s.name}</p>
                          <p className="text-xs text-pos-white/40">{s.salesCount} venda{s.salesCount > 1 ? "s" : ""}</p>
                        </div>
                      </div>
                      <div className="text-right space-y-0.5">
                        <p className="font-bold text-sm text-pos-orange">R$ {s.totalSales.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                        <p className="text-[10px] text-pos-white/40">
                          ticket: R$ {(s.totalSales / s.salesCount).toFixed(2)} · {(s.totalItems / s.salesCount).toFixed(1)} itens/venda
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Operational Alerts */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
                Alertas Operacionais
                {totalAlerts > 0 && (
                  <Badge className="bg-red-500 text-white border-0 text-[10px] h-4 min-w-4 px-1 animate-pulse">
                    {totalAlerts}
                  </Badge>
                )}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <AlertCard
                  icon={MessageSquare}
                  label="WhatsApp"
                  count={whatsappAwaiting + whatsappNew}
                  detail={`${whatsappAwaiting} aguardando · ${whatsappNew} novas`}
                  onClick={() => onNavigateToSection("whatsapp")}
                />
                <AlertCard
                  icon={Headphones}
                  label="Suporte"
                  count={supportTickets}
                  detail="tickets abertos"
                  onClick={() => onNavigateToSection("chat")}
                />
                <AlertCard
                  icon={ArrowRightLeft}
                  label="Solicitações"
                  count={pendingRequests}
                  detail="pendentes"
                  onClick={() => onNavigateToSection("requests")}
                />
              </div>
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function KPICard({ icon: Icon, label, value, sub, color }: { icon: typeof DollarSign; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="p-4 rounded-xl bg-pos-white/5 border border-pos-orange/10 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-xs text-pos-white/50">{label}</span>
      </div>
      <p className="text-xl font-bold text-pos-white">{value}</p>
      <p className="text-[10px] text-pos-white/30">{sub}</p>
    </div>
  );
}

function AlertCard({ icon: Icon, label, count, detail, onClick }: { icon: typeof MessageSquare; label: string; count: number; detail: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10 hover:bg-pos-white/10 transition-all text-left w-full group"
    >
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${count > 0 ? "bg-red-500/20" : "bg-pos-white/10"}`}>
          <Icon className={`h-4 w-4 ${count > 0 ? "text-red-400" : "text-pos-white/40"}`} />
        </div>
        <div>
          <p className="text-sm font-medium text-pos-white">{label}</p>
          <p className="text-[10px] text-pos-white/40">{detail}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {count > 0 && (
          <Badge className="bg-red-500 text-white border-0 text-xs animate-pulse">
            {count}
          </Badge>
        )}
        <ChevronRight className="h-4 w-4 text-pos-white/20 group-hover:text-pos-white/50 transition-colors" />
      </div>
    </button>
  );
}
