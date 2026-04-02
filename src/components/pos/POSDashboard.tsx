import { useState, useEffect } from "react";
import {
  DollarSign, ShoppingCart, TrendingUp, Package, Loader2,
  RefreshCw, BarChart3, Users, MessageSquare, Headphones,
  ArrowRightLeft, ChevronRight, CalendarIcon, AlertTriangle,
  Globe, Store, Lock, ListChecks, Check, Phone, Send, UserCheck
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { POSGoalProgress } from "./POSGoalProgress";
import { POSSellerPrivatePanel } from "./POSSellerPrivatePanel";
import { POSTaskWhatsAppDialog } from "./POSTaskWhatsAppDialog";
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
  sellerId?: string;
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
    start.setDate(1); // primeiro dia do mês calendário
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

  // Online vs Physical
  const [onlineRevenue, setOnlineRevenue] = useState(0);
  const [onlineSalesCount, setOnlineSalesCount] = useState(0);
  const [physicalRevenue, setPhysicalRevenue] = useState(0);
  const [physicalSalesCount, setPhysicalSalesCount] = useState(0);

  // Seller metrics
  const [sellerMetrics, setSellerMetrics] = useState<SellerMetric[]>([]);

  // Alerts
  const [whatsappAwaiting, setWhatsappAwaiting] = useState(0);
  const [whatsappNew, setWhatsappNew] = useState(0);
  const [supportTickets, setSupportTickets] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [showPrivatePanel, setShowPrivatePanel] = useState(false);
  
  // Contact tasks
  const [contactTasks, setContactTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [influencedRevenue, setInfluencedRevenue] = useState(0);
  const [completingTask, setCompletingTask] = useState<string | null>(null);
  const [completionNotes, setCompletionNotes] = useState<Record<string, string>>({});
  const [completionSeller, setCompletionSeller] = useState<Record<string, string>>({});
  const [storeSellers, setStoreSellers] = useState<{ id: string; name: string }[]>([]);
  const [taskWhatsAppPhone, setTaskWhatsAppPhone] = useState<string | null>(null);
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

  const loadContactTasks = async () => {
    setLoadingTasks(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("pos_seller_tasks" as any)
        .select("*")
        .eq("store_id", storeId)
        .eq("status", "pending")
        .order("due_date", { ascending: true });
      setContactTasks((data as any[]) || []);

      // Calculate influenced revenue: sales from customers who were contacted (completed tasks) in the period
      const { start, end } = getPeriodRange(period, customRange);
      const { data: completedTasks } = await supabase
        .from("pos_seller_tasks" as any)
        .select("customer_phone")
        .eq("store_id", storeId)
        .eq("status", "completed");

      if (completedTasks && (completedTasks as any[]).length > 0) {
        const phones = [...new Set((completedTasks as any[]).map((t: any) => t.customer_phone).filter(Boolean))];
        if (phones.length > 0) {
          const query = supabase
            .from("pos_sales")
            .select("total")
            .eq("store_id", storeId)
            .eq("status", "completed")
            .or(`and(paid_at.gte.${start.toISOString()},paid_at.lte.${end.toISOString()}),and(paid_at.is.null,created_at.gte.${start.toISOString()},created_at.lte.${end.toISOString()})`);
          const { data: influencedSales } = await (query as any).in("customer_phone", phones);
          setInfluencedRevenue((influencedSales || []).reduce((s, sale) => s + (sale.total || 0), 0));
        } else {
          setInfluencedRevenue(0);
        }
      } else {
        setInfluencedRevenue(0);
      }
    } catch (e) {
      console.error("Load contact tasks error:", e);
    } finally {
      setLoadingTasks(false);
    }
  };

  const loadSellers = async () => {
    const { data } = await supabase
      .from("pos_sellers")
      .select("id, name")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .order("name");
    setStoreSellers(data || []);
  };

  const handleCompleteTask = async (task: any) => {
    const notes = completionNotes[task.id];
    if (!notes || notes.trim().length < 3) {
      return; // require notes
    }
    const selectedSellerId = completionSeller[task.id];
    if (!selectedSellerId) {
      return; // require seller selection
    }
    setCompletingTask(task.id);
    try {
      await supabase.from("pos_seller_tasks" as any).update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completion_notes: notes.trim(),
        completed_by_seller_id: selectedSellerId,
      }).eq("id", task.id);

      // Add gamification points to the seller who completed the task
      if (task.points_reward) {
        const { data: gam } = await supabase
          .from("pos_gamification")
          .select("id, weekly_points, total_points")
          .eq("seller_id", selectedSellerId)
          .eq("store_id", storeId)
          .maybeSingle();
        if (gam) {
          await supabase.from("pos_gamification").update({
            weekly_points: (gam.weekly_points || 0) + (task.points_reward || 0),
            total_points: (gam.total_points || 0) + (task.points_reward || 0),
          }).eq("id", gam.id);
        } else {
          await supabase.from("pos_gamification").insert({
            seller_id: selectedSellerId,
            store_id: storeId,
            weekly_points: task.points_reward || 0,
            total_points: task.points_reward || 0,
            total_sales: 0,
            complete_registrations: 0,
            fast_requests_answered: 0,
            returns_count: 0,
          } as any);
        }
      }

      setCompletionNotes(prev => { const n = { ...prev }; delete n[task.id]; return n; });
      setCompletionSeller(prev => { const n = { ...prev }; delete n[task.id]; return n; });
      loadContactTasks();
    } catch (e) {
      console.error("Complete task error:", e);
    } finally {
      setCompletingTask(null);
    }
  };
  const loadSalesData = async () => {
    setLoading(true);
    try {
      const { start, end } = getPeriodRange(period, customRange);

      // Use paid_at when available, fallback to created_at for older sales without paid_at
      const { data: sales } = await supabase
        .from("pos_sales")
        .select("id, total, seller_id, status, sale_type, subtotal, discount, payment_details, paid_at, created_at")
        .eq("store_id", storeId)
        .eq("status", "completed")
        .or(`and(paid_at.gte.${start.toISOString()},paid_at.lte.${end.toISOString()}),and(paid_at.is.null,created_at.gte.${start.toISOString()},created_at.lte.${end.toISOString()})`);

      const completedSales = sales || [];
      const revenue = completedSales.reduce((s, sale) => s + (sale.total || 0), 0);
      const count = completedSales.length;

      setTotalRevenue(revenue);
      setSalesCount(count);
      setAvgTicket(count > 0 ? revenue / count : 0);

      // Online vs Physical breakdown
      const online = completedSales.filter((s: any) => s.sale_type === 'online' || s.sale_type === 'live');
      const physical = completedSales.filter((s: any) => s.sale_type !== 'online' && s.sale_type !== 'live');
      setOnlineRevenue(online.reduce((sum, s) => sum + (s.total || 0), 0));
      setOnlineSalesCount(online.length);
      setPhysicalRevenue(physical.reduce((sum, s) => sum + (s.total || 0), 0));
      setPhysicalSalesCount(physical.length);

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
          const existing = metricsMap.get(key) || { name, totalSales: 0, salesCount: 0, totalItems: 0, sellerId: sale.seller_id || undefined };
          // Use net product value (total minus shipping) for seller metrics
          const pd = (sale as any).payment_details as any;
          const shippingAmt = pd?.shipping_amount || 0;
          const netProductTotal = (sale.total || 0) - shippingAmt;
          existing.totalSales += netProductTotal;
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
    loadContactTasks();
    loadSellers();
  }, [storeId]);

  useEffect(() => {
    if (period === "custom" && !customRange?.from) return;
    loadContactTasks();
  }, [period, customRange]);

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

            {/* Online vs Physical breakdown */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
                <Store className="h-4 w-4 text-pos-orange" /> Vendas por Canal
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-pos-white/5 border border-pos-orange/10 space-y-2">
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-green-400" />
                    <span className="text-xs text-pos-white/50">Loja Física</span>
                  </div>
                  <p className="text-xl font-bold text-pos-white">R$ {physicalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                  <p className="text-[10px] text-pos-white/30">{physicalSalesCount} venda{physicalSalesCount !== 1 ? "s" : ""}</p>
                </div>
                <div className="p-4 rounded-xl bg-pos-white/5 border border-pos-orange/10 space-y-2">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-blue-400" />
                    <span className="text-xs text-pos-white/50">Online</span>
                  </div>
                  <p className="text-xl font-bold text-pos-white">R$ {onlineRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                  <p className="text-[10px] text-pos-white/30">{onlineSalesCount} venda{onlineSalesCount !== 1 ? "s" : ""}</p>
                </div>
              </div>
            </div>

            {/* Goal Progress */}
            <POSGoalProgress
              storeId={storeId}
              totalRevenue={totalRevenue}
              avgTicket={avgTicket}
              avgItemsPerSale={avgItemsPerSale}
              salesCount={salesCount}
              period={period}
              sellerMetrics={sellerMetrics.map(s => ({ ...s, sellerId: s.sellerId }))}
            />

            {/* Seller Metrics */}
            {sellerMetrics.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
                    <Users className="h-4 w-4 text-pos-orange" /> Desempenho por Vendedor
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 text-xs"
                    onClick={() => setShowPrivatePanel(true)}
                  >
                    <Lock className="h-3 w-3" /> Meus Dados
                  </Button>
                </div>
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

            {/* Tarefas */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-pos-orange" /> Tarefas
                {contactTasks.length > 0 && (
                  <Badge className="bg-pos-orange/20 text-pos-orange border-0 text-[10px]">{contactTasks.length}</Badge>
                )}
              </h3>
              {loadingTasks ? (
                <div className="flex items-center justify-center py-6 text-pos-white/50">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando tarefas...
                </div>
              ) : contactTasks.length === 0 ? (
                <div className="p-4 rounded-lg bg-pos-white/5 border border-pos-orange/10 text-center">
                  <p className="text-sm text-pos-white/40">Nenhuma tarefa pendente para hoje</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {contactTasks.map((t: any) => (
                    <div key={t.id} className="p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={false}
                          disabled={completingTask === t.id}
                          onCheckedChange={() => {
                            if (completionNotes[t.id]?.trim() && completionSeller[t.id]) {
                              handleCompleteTask(t);
                            }
                          }}
                          className="mt-0.5 border-pos-orange/40 data-[state=checked]:bg-pos-orange"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-pos-white truncate">{t.title}</p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {t.rfm_segment && <Badge className="text-[10px] bg-red-500/20 text-red-400 border-0">{t.rfm_segment}</Badge>}
                              <Badge className="text-[10px] bg-pos-orange/20 text-pos-orange border-0">{t.points_reward} pts</Badge>
                            </div>
                          </div>
                          {t.customer_name && (
                            <p className="text-xs text-pos-white/50 mt-0.5 flex items-center gap-1.5 flex-wrap">
                              👤 {t.customer_name} {t.customer_phone ? `· 📞 ${t.customer_phone}` : ''}
                              {t.customer_phone && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 gap-1 bg-green-600 hover:bg-green-700 text-white text-[10px] rounded-full"
                                  onClick={() => setTaskWhatsAppPhone(t.customer_phone)}
                                >
                                  <Phone className="h-3 w-3" /> WhatsApp
                                </Button>
                              )}
                            </p>
                          )}
                          {t.description && (
                            <p className="text-[10px] text-pos-white/40 mt-0.5 whitespace-pre-line line-clamp-2">{t.description}</p>
                          )}
                          {t.contact_strategy && (
                            <p className="text-xs text-pos-white/40 mt-0.5 italic">💡 {t.contact_strategy}</p>
                          )}
                          {/* Seller selector + Completion notes */}
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <UserCheck className="h-3.5 w-3.5 text-pos-white/40 shrink-0" />
                              <Select
                                value={completionSeller[t.id] || ""}
                                onValueChange={v => setCompletionSeller(prev => ({ ...prev, [t.id]: v }))}
                              >
                                <SelectTrigger className="h-8 text-xs bg-pos-white/5 border-pos-orange/20 text-pos-white">
                                  <SelectValue placeholder="Quem realizou?" />
                                </SelectTrigger>
                                <SelectContent>
                                  {storeSellers.map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex gap-2">
                              <Textarea
                                placeholder="Como foi o contato? (obrigatório para concluir)"
                                value={completionNotes[t.id] || ""}
                                onChange={e => setCompletionNotes(prev => ({ ...prev, [t.id]: e.target.value }))}
                                className="h-16 text-xs bg-pos-white/5 border-pos-orange/20 text-pos-white resize-none"
                              />
                              <Button
                                size="sm"
                                className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted h-16 px-3"
                                disabled={!completionNotes[t.id]?.trim() || !completionSeller[t.id] || completingTask === t.id}
                                onClick={() => handleCompleteTask(t)}
                              >
                                {completingTask === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Influenced Revenue */}
            {influencedRevenue > 0 && (
              <div className="p-4 rounded-xl bg-gradient-to-r from-green-500/10 to-pos-orange/10 border border-green-500/20 space-y-1">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-400" />
                  <span className="text-xs text-pos-white/60">Faturamento Influenciado por CRM</span>
                </div>
                <p className="text-xl font-bold text-green-400">R$ {influencedRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                <p className="text-[10px] text-pos-white/30">Vendas para clientes que foram contatados via tarefas</p>
              </div>
            )}

            {/* Seller Complaints */}
            <SellerComplaintsCard storeId={storeId} />

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

      <POSSellerPrivatePanel
        open={showPrivatePanel}
        onClose={() => setShowPrivatePanel(false)}
        storeId={storeId}
        period={period}
        periodStart={getPeriodRange(period, customRange).start}
        periodEnd={getPeriodRange(period, customRange).end}
        sellerMetrics={sellerMetrics}
      />

      <POSTaskWhatsAppDialog
        open={!!taskWhatsAppPhone}
        onOpenChange={(open) => { if (!open) setTaskWhatsAppPhone(null); }}
        storeId={storeId}
        customerPhone={taskWhatsAppPhone || undefined}
      />
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

function SellerComplaintsCard({ storeId }: { storeId: string }) {
  const [complaints, setComplaints] = useState<{ seller_name: string; wrong_feet: number; defective: number; total: number }[]>([]);

  useEffect(() => {
    loadComplaints();
  }, [storeId]);

  const loadComplaints = async () => {
    const { data } = await supabase
      .from("pos_seller_complaints" as any)
      .select("seller_id, complaint_type, created_at")
      .eq("store_id", storeId);

    if (!data || (data as any[]).length === 0) return;

    const { data: sellers } = await supabase
      .from("pos_sellers")
      .select("id, name")
      .eq("store_id", storeId);

    const sellerMap = new Map((sellers || []).map(s => [s.id, s.name]));
    const map = new Map<string, { seller_name: string; wrong_feet: number; defective: number; total: number }>();

    for (const c of (data as any[])) {
      const name = sellerMap.get(c.seller_id) || "Desconhecido";
      const entry = map.get(c.seller_id) || { seller_name: name, wrong_feet: 0, defective: 0, total: 0 };
      if (c.complaint_type === "wrong_feet") entry.wrong_feet++;
      else entry.defective++;
      entry.total++;
      map.set(c.seller_id, entry);
    }

    setComplaints(Array.from(map.values()).sort((a, b) => b.total - a.total));
  };

  if (complaints.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-400" /> Reclamações por Vendedor
      </h3>
      <div className="space-y-2">
        {complaints.map((c, i) => (
          <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-red-500/5 border border-red-500/10">
            <div>
              <p className="font-medium text-sm text-pos-white">{c.seller_name}</p>
              <p className="text-[10px] text-pos-white/40">
                {c.wrong_feet > 0 && `👟 Pés trocados: ${c.wrong_feet}`}
                {c.wrong_feet > 0 && c.defective > 0 && " · "}
                {c.defective > 0 && `🔧 Defeitos: ${c.defective}`}
              </p>
            </div>
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{c.total} ocorrência{c.total > 1 ? "s" : ""}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
