import { useState, useEffect } from "react";
import {
  DollarSign, ShoppingCart, TrendingUp, Package, Loader2,
  RefreshCw, BarChart3, Users, MessageSquare, Headphones,
  ArrowRightLeft, ChevronRight, CalendarIcon, AlertTriangle,
  Globe, Store, Lock, Share2, Award, Trophy, Medal,
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

import { POSSellerPrivatePanel } from "./POSSellerPrivatePanel";
import { POSTaskWhatsAppDialog } from "./POSTaskWhatsAppDialog";
import { POSMetaPixelCard } from "./POSMetaPixelCard";
import { POSStoreScaledGoals } from "./POSStoreScaledGoals";
import { POSStoreGoalCards } from "./POSStoreGoalCards";
import { POSChannelSalesModal, type ChannelSale } from "./POSChannelSalesModal";

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
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (period === "week") start.setDate(start.getDate() - 6);
  else if (period === "month") start.setDate(1);
  return { start, end };
}

export function POSDashboard({ storeId, onNavigateToSection }: Props) {
  const [period, setPeriod] = useState<Period>("day");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [loading, setLoading] = useState(true);

  const [totalRevenue, setTotalRevenue] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [avgTicket, setAvgTicket] = useState(0);
  const [avgItemsPerSale, setAvgItemsPerSale] = useState(0);

  const [onlineRevenue, setOnlineRevenue] = useState(0);
  const [onlineSalesCount, setOnlineSalesCount] = useState(0);
  const [physicalRevenue, setPhysicalRevenue] = useState(0);
  const [physicalSalesCount, setPhysicalSalesCount] = useState(0);
  const [liveRevenue, setLiveRevenue] = useState(0);
  const [liveSalesCount, setLiveSalesCount] = useState(0);

  const [physicalSales, setPhysicalSales] = useState<ChannelSale[]>([]);
  const [onlineSales, setOnlineSales] = useState<ChannelSale[]>([]);
  const [liveSales, setLiveSales] = useState<ChannelSale[]>([]);
  const [activeChannel, setActiveChannel] = useState<"physical" | "online" | "live" | null>(null);

  const [sellerMetrics, setSellerMetrics] = useState<SellerMetric[]>([]);

  const [whatsappAwaiting, setWhatsappAwaiting] = useState(0);
  const [whatsappNew, setWhatsappNew] = useState(0);
  const [supportTickets, setSupportTickets] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [showPrivatePanel, setShowPrivatePanel] = useState(false);

  const [influencedRevenue, setInfluencedRevenue] = useState(0);
  const [taskWhatsAppPhone, setTaskWhatsAppPhone] = useState<string | null>(null);
  // PAGO É PAGO: contabiliza apenas pedidos efetivamente pagos.
  // `pending_pickup` é "aguardando pagamento na retirada" (paid_at sempre null) — NÃO conta como receita.
  // Status de fulfillment (awaiting_shipping/mototaxi/pickup/concluido/enviado) ficam em `db_orders.stage`,
  // não em `pos_sales.status`, então mover um card no kanban NÃO remove a venda paga do dashboard.
  const revenueStatuses = ["completed", "pending_sync", "paid"];

  const loadAlerts = async () => {
    const [conversationRes, supportRes, interStoreRes, stockRes] = await Promise.all([
      supabase.rpc("get_conversation_counts"),
      supabase.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["new", "in_progress"]),
      supabase.from("pos_inter_store_requests").select("id", { count: "exact", head: true }).eq("to_store_id", storeId).eq("status", "pending"),
      supabase.from("expedition_stock_requests").select("id", { count: "exact", head: true }).eq("to_store_id", storeId).eq("status", "pending"),
    ]);
    if (conversationRes.data && conversationRes.data.length > 0) {
      const d = conversationRes.data[0];
      setWhatsappAwaiting(Number(d.awaiting_count) || 0);
      setWhatsappNew(Number(d.new_count) || 0);
    }
    setSupportTickets(supportRes.count || 0);
    setPendingRequests((interStoreRes.count || 0) + (stockRes.count || 0));
  };

  const loadInfluenced = async () => {
    try {
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
            .from("pos_sales").select("total")
            .eq("store_id", storeId).eq("status", "completed")
            .or(`and(paid_at.gte.${start.toISOString()},paid_at.lte.${end.toISOString()}),and(paid_at.is.null,created_at.gte.${start.toISOString()},created_at.lte.${end.toISOString()})`);
          const { data: influencedSales } = await (query as any).in("customer_phone", phones);
          setInfluencedRevenue((influencedSales || []).reduce((s, sale) => s + (sale.total || 0), 0));
        } else setInfluencedRevenue(0);
      } else setInfluencedRevenue(0);
    } catch (e) { console.error(e); }
  };

  const loadSalesData = async () => {
    setLoading(true);
    try {
      const { start, end } = getPeriodRange(period, customRange);
      const { data: sales } = await supabase
        .from("pos_sales")
        .select("id, total, seller_id, status, sale_type, subtotal, discount, payment_details, paid_at, created_at, revenue_attribution, event_id, customer_name, customer_phone, payment_method, customer_cpf")
        .eq("store_id", storeId)
        .eq("expedition_stage", "concluido")
        .in("status", revenueStatuses)
        .or(`and(paid_at.gte.${start.toISOString()},paid_at.lte.${end.toISOString()}),and(paid_at.is.null,created_at.gte.${start.toISOString()},created_at.lte.${end.toISOString()})`);

      const completedSales = (sales || []).filter((s: any) => s.revenue_attribution !== "site_pickup_only");
      const revenue = completedSales.reduce((s, sale) => s + (sale.total || 0), 0);
      const count = completedSales.length;
      setTotalRevenue(revenue);
      setSalesCount(count);
      setAvgTicket(count > 0 ? revenue / count : 0);

      const online = completedSales.filter((s: any) => s.sale_type === 'online');
      const physical = completedSales.filter((s: any) => s.sale_type !== 'online' && s.sale_type !== 'live');
      setOnlineRevenue(online.reduce((sum, s) => sum + (s.total || 0), 0));
      setOnlineSalesCount(online.length);
      setPhysicalRevenue(physical.reduce((sum, s) => sum + (s.total || 0), 0));
      setPhysicalSalesCount(physical.length);
      setOnlineSales(online as ChannelSale[]);
      setPhysicalSales(physical as ChannelSale[]);

      // Faturamento Live: vendas pagas vinculadas a um evento.
      // `completedSales` já está filtrado pelos status pagos (completed/paid/pending_sync),
      // então não precisamos exigir paid_at aqui — pedidos `completed` legados sem paid_at
      // também são vendas pagas legítimas.
      const liveList = completedSales.filter((s: any) => s.event_id);
      setLiveRevenue(liveList.reduce((sum, s) => sum + (s.total || 0), 0));
      setLiveSalesCount(liveList.length);
      setLiveSales(liveList as ChannelSale[]);

      if (completedSales.length > 0) {
        const saleIds = completedSales.map((s) => s.id);
        // Fetch items in chunks — a single .in() with hundreds of IDs blows the URL
        // length / row limit and silently returns nothing (itens/venda = 0).
        const items: { sale_id: string; quantity: number }[] = [];
        const chunkSize = 300;
        for (let i = 0; i < saleIds.length; i += chunkSize) {
          const slice = saleIds.slice(i, i + chunkSize);
          const { data: chunkItems } = await supabase
            .from("pos_sale_items")
            .select("sale_id, quantity")
            .in("sale_id", slice)
            .limit(20000);
          if (chunkItems) items.push(...(chunkItems as any));
        }
        const totalItems = items.reduce((s, i) => s + (i.quantity || 0), 0);
        setAvgItemsPerSale(count > 0 ? totalItems / count : 0);

        const { data: sellersData } = await supabase.from("pos_sellers").select("id, name").eq("store_id", storeId);
        const sellersMap = new Map((sellersData || []).map((s) => [s.id, s.name]));
        const metricsMap = new Map<string, SellerMetric>();
        const saleItemsMap = new Map<string, number>();
        for (const item of items || []) saleItemsMap.set(item.sale_id, (saleItemsMap.get(item.sale_id) || 0) + (item.quantity || 0));
        for (const sale of completedSales) {
          const key = sale.seller_id || "sem-vendedor";
          const name = sellersMap.get(sale.seller_id || "") || "Sem vendedor";
          const existing = metricsMap.get(key) || { name, totalSales: 0, salesCount: 0, totalItems: 0, sellerId: sale.seller_id || undefined };
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
    } catch (e) { console.error("Dashboard load error:", e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (period === "custom" && !customRange?.from) return;
    loadSalesData();
    loadInfluenced();
  }, [storeId, period, customRange]);

  useEffect(() => { loadAlerts(); }, [storeId]);

  const handlePeriodChange = (v: string) => {
    if (!v) return;
    if (v !== "custom") setCustomRange(undefined);
    setPeriod(v as Period);
  };

  const periodLabel = period === "day" ? "Hoje"
    : period === "week" ? "Esta semana"
    : period === "month" ? "Este mês"
    : customRange?.from ? `${format(customRange.from, "dd/MM", { locale: ptBR })}${customRange.to ? ` - ${format(customRange.to, "dd/MM", { locale: ptBR })}` : ""}` : "Personalizado";

  const totalAlerts = whatsappAwaiting + whatsappNew + supportTickets + pendingRequests;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: "var(--gradient-pos-bg)", color: "hsl(var(--pos-text))" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 flex-wrap gap-3 border-b border-black/5">
        <h2 className="text-lg md:text-xl font-bold tracking-wide uppercase" style={{ color: "hsl(var(--pos-text))" }}>
          Visão Geral do PDV
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-black/5 rounded-full p-0.5 border border-black/5">
            {(["day","week","month","custom"] as Period[]).map(p => {
              const active = period === p;
              return (
                <button
                  key={p}
                  onClick={() => handlePeriodChange(p)}
                  className={cn(
                    "text-xs px-4 py-1.5 rounded-full font-medium transition-all",
                    active ? "text-white" : "text-black/60 hover:text-black/80"
                  )}
                  style={active ? { background: "var(--gradient-pos-accent)", boxShadow: "var(--shadow-pos-glow)" } : undefined}
                >
                  {p === "day" ? "Dia" : p === "week" ? "Semana" : p === "month" ? "Mês" : (
                    <span className="flex items-center gap-1"><CalendarIcon className="h-3 w-3" />Período</span>
                  )}
                </button>
              );
            })}
          </div>

          {period === "custom" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs bg-white border-black/10 text-black/70 hover:bg-black/5">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {customRange?.from
                    ? `${format(customRange.from, "dd/MM")}${customRange.to ? ` - ${format(customRange.to, "dd/MM")}` : ""}`
                    : "Selecionar"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="range" selected={customRange} onSelect={setCustomRange} disabled={(d) => d > new Date()} locale={ptBR} numberOfMonths={2} initialFocus />
              </PopoverContent>
            </Popover>
          )}

          <Button variant="outline" size="icon" className="h-8 w-8 rounded-full bg-white border-black/10 text-black/60 hover:bg-black/5" onClick={() => { loadSalesData(); loadAlerts(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          <Button variant="outline" size="sm" className="gap-1.5 text-xs bg-white border-black/10 text-black/70 hover:bg-black/5 rounded-full px-3">
            <Share2 className="h-3.5 w-3.5" /> Compartilhar
          </Button>
          <Button size="sm" className="text-xs rounded-full px-4 text-white border-0" style={{ background: "var(--gradient-pos-accent)", boxShadow: "var(--shadow-pos-glow)" }}>
            Publicar
          </Button>
        </div>
      </div>

      <style>{`
        [data-state=on].pos-pill { background: var(--gradient-pos-accent); color:#fff; box-shadow: var(--shadow-pos-glow); }
      `}</style>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-black/40">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando dashboard...
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6 max-w-[1400px] mx-auto w-full">

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard icon={DollarSign} label="Faturamento" value={`R$ ${totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} sub={periodLabel} trend="up" />
              <KPICard icon={ShoppingCart} label="Vendas" value={String(salesCount)} sub={periodLabel} trend="bars" />
              <KPICard icon={TrendingUp} label="Ticket Médio" value={`R$ ${avgTicket.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} sub={periodLabel} trend="line" />
              <KPICard icon={Package} label="Itens/Venda" value={avgItemsPerSale.toFixed(1)} sub={periodLabel} trend="wave" />
            </div>

            {/* Metas da Loja (Dia / Semana / Mês) */}
            <div className="space-y-3">
              <div className="flex items-center justify-center">
                <h3 className="text-sm font-bold tracking-[0.2em] uppercase text-black/70">Progresso das Metas</h3>
              </div>
              <POSStoreGoalCards storeId={storeId} />
            </div>

            {/* Vendas por Canal */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-black/70">
                <Store className="h-4 w-4" /> Vendas por Canal
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ChannelCard
                  type="store"
                  title="Loja Física"
                  value={`R$ ${physicalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                  sub={`${physicalSalesCount} venda${physicalSalesCount !== 1 ? "s" : ""}${totalRevenue > 0 ? ` (${Math.round(physicalRevenue / totalRevenue * 100)}%)` : ""}`}
                  onClick={() => setActiveChannel("physical")}
                />
                <ChannelCard
                  type="online"
                  title="Online"
                  value={`R$ ${onlineRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                  sub={`${onlineSalesCount} venda${onlineSalesCount !== 1 ? "s" : ""}`}
                  onClick={() => setActiveChannel("online")}
                />
                <ChannelCard
                  type="store"
                  title="Faturamento Live"
                  value={`R$ ${liveRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                  sub={`${liveSalesCount} venda${liveSalesCount !== 1 ? "s" : ""}${totalRevenue > 0 ? ` (${Math.round(liveRevenue / totalRevenue * 100)}%)` : ""} · vindas de eventos`}
                  onClick={() => setActiveChannel("live")}
                />
              </div>

            </div>





            {/* Metas Escalonadas (espelho da aba Folha, filtrado pela loja) */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold tracking-[0.2em] uppercase text-black/70 flex items-center gap-2 justify-center">
                <Trophy className="h-4 w-4 text-orange-500" /> Metas Escalonadas & Comissão
              </h3>
              <div
                className="rounded-2xl p-5 border border-black/5"
                style={{ background: "var(--gradient-pos-silver)", boxShadow: "var(--shadow-pos-card), var(--shadow-pos-inset)" }}
              >
                <POSStoreScaledGoals
                  storeId={storeId}
                  periodStart={getPeriodRange(period, customRange).start}
                  periodEnd={getPeriodRange(period, customRange).end}
                  periodLabel={periodLabel}
                />
              </div>
            </div>



            {/* Seller Metrics */}
            {sellerMetrics.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-black/70">
                    <Users className="h-4 w-4" /> Desempenho por Vendedor
                  </h3>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs bg-white border-black/10 text-black/70 hover:bg-black/5" onClick={() => setShowPrivatePanel(true)}>
                    <Lock className="h-3 w-3" /> Meus Dados
                  </Button>
                </div>
                <div className="rounded-2xl border border-black/5 bg-white/70 backdrop-blur p-2 space-y-1" style={{ boxShadow: "var(--shadow-pos-card)" }}>
                  {sellerMetrics.map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl hover:bg-black/[0.03] transition-colors">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ background: i === 0 ? "var(--gradient-pos-gold)" : i === 1 ? "var(--gradient-pos-silver-strong)" : i === 2 ? "var(--gradient-pos-bronze)" : "linear-gradient(135deg, #555, #333)" }}
                        >
                          {i + 1}º
                        </div>
                        <div>
                          <p className="font-medium text-sm">{s.name}</p>
                          <p className="text-xs text-black/40">{s.salesCount} venda{s.salesCount > 1 ? "s" : ""}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-black/80">R$ {s.totalSales.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                        <p className="text-[10px] text-black/40">
                          ticket: R$ {(s.totalSales / s.salesCount).toFixed(2)} · {(s.totalItems / s.salesCount).toFixed(1)} itens/venda
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {influencedRevenue > 0 && (
              <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-50/70 space-y-1" style={{ boxShadow: "var(--shadow-pos-card)" }}>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs text-black/60">Faturamento Influenciado por CRM</span>
                </div>
                <p className="text-xl font-bold text-emerald-700">R$ {influencedRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                <p className="text-[10px] text-black/40">Vendas para clientes contatados via tarefas</p>
              </div>
            )}

            <SellerComplaintsCard storeId={storeId} />

            {/* Operational Alerts */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-black/70">
                Alertas Operacionais
                {totalAlerts > 0 && (
                  <Badge className="bg-red-500 text-white border-0 text-[10px] h-4 min-w-4 px-1 animate-pulse">{totalAlerts}</Badge>
                )}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <AlertCard icon={MessageSquare} label="WhatsApp" count={whatsappAwaiting + whatsappNew} detail={`${whatsappAwaiting} aguardando · ${whatsappNew} novas`} onClick={() => onNavigateToSection("whatsapp")} />
                <AlertCard icon={Headphones} label="Suporte" count={supportTickets} detail="tickets abertos" onClick={() => onNavigateToSection("chat")} />
                <AlertCard icon={ArrowRightLeft} label="Solicitações" count={pendingRequests} detail="pendentes" onClick={() => onNavigateToSection("requests")} />
              </div>
            </div>

            <POSMetaPixelCard onOpen={() => onNavigateToSection("meta-pixel")} />
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

      <POSChannelSalesModal
        open={activeChannel !== null}
        onClose={() => setActiveChannel(null)}
        title={activeChannel === "physical" ? "Vendas — Loja Física" : activeChannel === "online" ? "Vendas — Online" : "Vendas — Faturamento Live (Eventos)"}
        channel={activeChannel ?? "physical"}
        sales={activeChannel === "physical" ? physicalSales : activeChannel === "online" ? onlineSales : activeChannel === "live" ? liveSales : []}
      />
    </div>
  );
}

/* ============ subcomponents ============ */

function MiniSparkline({ variant }: { variant: "up" | "bars" | "line" | "wave" }) {
  if (variant === "bars") {
    const bars = [4, 7, 5, 9, 6, 11, 8, 13, 9, 12, 10, 14];
    return (
      <svg viewBox="0 0 60 20" className="w-full h-6 opacity-50">
        {bars.map((h, i) => (
          <rect key={i} x={i * 5} y={20 - h} width={3} height={h} rx={0.5} fill="hsl(var(--pos-text))" />
        ))}
      </svg>
    );
  }
  const paths: Record<string, string> = {
    up: "M0,16 L10,14 L20,15 L30,10 L40,12 L50,6 L60,4",
    line: "M0,12 L10,10 L20,13 L30,8 L40,11 L50,7 L60,5",
    wave: "M0,12 L10,9 L20,13 L30,8 L40,14 L50,9 L60,11",
  };
  return (
    <svg viewBox="0 0 60 20" className="w-full h-6 opacity-50">
      <path d={paths[variant]} fill="none" stroke="hsl(var(--pos-text))" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KPICard({ icon: Icon, label, value, sub, trend }: { icon: typeof DollarSign; label: string; value: string; sub: string; trend: "up" | "bars" | "line" | "wave" }) {
  return (
    <div
      className="relative p-4 rounded-2xl overflow-hidden group hover:-translate-y-0.5 transition-transform border border-black/[0.04]"
      style={{ background: "var(--gradient-pos-silver)", boxShadow: "var(--shadow-pos-card), var(--shadow-pos-inset)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-black/55">
          <Icon className="h-3.5 w-3.5" />
          <span>{label}</span>
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight text-black/85">{value}</p>
      <div className="flex items-end justify-between mt-1 gap-2">
        <p className="text-[10px] text-black/45 uppercase tracking-wider font-medium">{sub}</p>
        <div className="flex-1 max-w-[80px]">
          <MiniSparkline variant={trend} />
        </div>
      </div>
    </div>
  );
}

function ChannelCard({ type, title, value, sub, onClick }: { type: "store" | "online"; title: string; value: string; sub: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative p-5 rounded-2xl overflow-hidden flex items-center gap-4 border border-black/[0.04] text-left w-full hover:-translate-y-0.5 hover:border-black/15 transition-all cursor-pointer"
      style={{ background: "var(--gradient-pos-silver)", boxShadow: "var(--shadow-pos-card), var(--shadow-pos-inset)" }}
    >
      {/* Visual icon side */}
      <div className="relative h-20 w-28 flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, hsl(30 15% 88%), hsl(30 10% 75%))" }}>
        {type === "store" ? (
          <Store className="h-10 w-10 text-black/40" strokeWidth={1.2} />
        ) : (
          <Globe className="h-10 w-10 text-black/40" strokeWidth={1.2} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-black/55 font-medium">{title}</p>
        <p className="text-xl md:text-2xl font-bold text-black/85 mt-0.5 truncate">{value}</p>
        <p className="text-[11px] text-black/45 mt-0.5">{sub}</p>
      </div>
      <ChevronRight className="h-6 w-6 text-black/25 flex-shrink-0" strokeWidth={1.5} />
    </button>
  );
}


function AlertCard({ icon: Icon, label, count, detail, onClick }: { icon: typeof MessageSquare; label: string; count: number; detail: string; onClick: () => void }) {
  const hasAlert = count > 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-between p-3.5 rounded-2xl border transition-all text-left w-full group hover:-translate-y-0.5",
        hasAlert ? "bg-red-50 border-red-200 hover:border-red-300" : "bg-white border-black/[0.06] hover:border-black/15"
      )}
      style={{ boxShadow: "var(--shadow-pos-card)" }}
    >
      <div className="flex items-center gap-3">
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center", hasAlert ? "bg-red-100" : "bg-black/5")}>
          <Icon className={cn("h-4 w-4", hasAlert ? "text-red-500" : "text-black/60")} />
        </div>
        <div>
          <p className="text-sm font-semibold text-black/80">{label}</p>
          <p className="text-[10px] text-black/45">{detail}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {hasAlert && <Badge className="bg-red-500 text-white border-0 text-xs font-bold animate-pulse">{count}</Badge>}
        <ChevronRight className="h-4 w-4 text-black/20 group-hover:text-black/50 group-hover:translate-x-0.5 transition-all" />
      </div>
    </button>
  );
}

function SellerComplaintsCard({ storeId }: { storeId: string }) {
  const [complaints, setComplaints] = useState<{ seller_name: string; wrong_feet: number; defective: number; total: number }[]>([]);

  useEffect(() => { loadComplaints(); }, [storeId]);

  const loadComplaints = async () => {
    const { data } = await supabase.from("pos_seller_complaints" as any).select("seller_id, complaint_type, created_at").eq("store_id", storeId);
    if (!data || (data as any[]).length === 0) return;
    const { data: sellers } = await supabase.from("pos_sellers").select("id, name").eq("store_id", storeId);
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
      <h3 className="text-sm font-semibold flex items-center gap-2 text-black/70">
        <AlertTriangle className="h-4 w-4 text-red-500" /> Reclamações por Vendedor
      </h3>
      <div className="space-y-2">
        {complaints.map((c, i) => (
          <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100">
            <div>
              <p className="font-medium text-sm text-black/80">{c.seller_name}</p>
              <p className="text-[10px] text-black/50">
                {c.wrong_feet > 0 && `👟 Pés trocados: ${c.wrong_feet}`}
                {c.wrong_feet > 0 && c.defective > 0 && " · "}
                {c.defective > 0 && `🔧 Defeitos: ${c.defective}`}
              </p>
            </div>
            <Badge className="bg-red-500/15 text-red-600 border-red-200">{c.total} ocorrência{c.total > 1 ? "s" : ""}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
