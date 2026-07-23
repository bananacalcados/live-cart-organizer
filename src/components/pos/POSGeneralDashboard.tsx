import { useEffect, useState, useMemo } from "react";
import { ArrowLeft, Store, TrendingUp, ShoppingBag, DollarSign, Package, Target, Loader2, RefreshCw, Download, CreditCard, Banknote, Wallet, Receipt, TrendingDown, Settings, CalendarIcon, ClipboardList, QrCode, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { startOfMonth, endOfMonth, startOfDay, startOfWeek, endOfDay, differenceInDays, isAfter, isBefore, subMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getBrazilianHolidays, countBusinessDays, parseLocalDate } from "@/lib/businessDays";
import { POSGoalsManagerDialog } from "./POSGoalsManagerDialog";
import { POSPaymentSalesModal } from "./POSPaymentSalesModal";
import { POSTaskManagerDialog } from "./POSTaskManagerDialog";
import { POSSellerTaskProgress } from "./POSSellerTaskProgress";
import { POSSellerLinkPageProgress } from "./POSSellerLinkPageProgress";
import { POSPayrollTab } from "./POSPayrollTab";
import { POSFiscalTab } from "./POSFiscalTab";



interface Props { onBack: () => void }

type Period = "today" | "week" | "month" | "month_pick" | "custom";

interface StoreData {
  id: string;
  name: string;
  revenue: number;
  sales: number;
  items: number;
  ticket: number;
  itemsPerSale: number;
  cost: number;
  shippingCost: number;
}

interface GoalRow {
  id: string;
  store_id: string;
  goal_value: number;
  period: string;
  period_start: string | null;
  period_end: string | null;
  goal_type: string;
  created_at?: string;
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Normalize payment method strings into a canonical bucket.
// IMPORTANTE: "Online" NÃO é forma de pagamento — é só o canal da venda.
// Toda venda paga deve ter um método real (PIX/Crédito/Débito/Dinheiro/etc.).
// Quando o método estiver vazio, cai em "Não informado" (auditoria), nunca em "Online".
function bucketPayment(raw: string | null, _saleType?: string | null): string {
  const s = (raw || "").toLowerCase().trim();
  if (!s) return "Não informado";
  if (s.includes("pix")) return "PIX";
  if (s.includes("crediário") || s.includes("crediario")) return "Crediário";
  // VPS é forma de pagamento EXCLUSIVA (não confundir com Vale Presente)
  if (/(^|[^a-z])vps([^a-z]|$)/.test(s)) return "VPS";
  if (s.includes("vale presente") || s.includes("vale-presente") || /(^|[^a-z])vp([^a-z]|$)/.test(s)) return "Vale Presente";
  if (s.includes("débito") || s.includes("debito") || s.includes("debit")) return "Débito";
  if (s.includes("crédito") || s.includes("credito") || s.includes("credit") || s.includes("cartão") || s.includes("cartao")) return "Crédito";
  if (s.includes("dinheiro") || s === "cash") return "Dinheiro";
  // Gateways da Shopify que NÃO entregam a forma real (PIX/Crédito), mas são um
  // canal conhecido. Mostramos como grupo próprio em vez de "Não informado".
  // "shopify" puro continua desconhecido (forma real não existe em lugar nenhum).
  if (s.includes("mercado")) return "Mercado Pago";
  if (s.includes("checkout")) return "Checkout Transparente";
  // Rótulos de CANAL/GATEWAY sem forma real recuperável → auditoria.
  if (s.includes("não informado") || s.includes("nao informado") ||
      s.includes("shopify") || s.includes("online") ||
      s.includes("paypal") || s.includes("yampi")) return "Não informado";
  return "Outros";
}

const PAYMENT_STYLE: Record<string, { icon: any; gradient: string }> = {
  "PIX":           { icon: Wallet,    gradient: "from-emerald-500/20 to-emerald-700/10" },
  "Crédito":       { icon: CreditCard, gradient: "from-blue-500/20 to-blue-700/10" },
  "Débito":        { icon: CreditCard, gradient: "from-cyan-500/20 to-cyan-700/10" },
  "Dinheiro":      { icon: Banknote,  gradient: "from-amber-500/20 to-amber-700/10" },
  "Crediário":     { icon: Receipt,   gradient: "from-orange-500/20 to-orange-700/10" },
  "Vale Presente": { icon: Wallet,    gradient: "from-fuchsia-500/20 to-fuchsia-700/10" },
  "VPS":           { icon: Wallet,    gradient: "from-pink-500/20 to-pink-700/10" },
  "Mercado Pago":  { icon: Wallet,    gradient: "from-sky-500/20 to-sky-700/10" },
  "Checkout Transparente": { icon: CreditCard, gradient: "from-violet-500/20 to-violet-700/10" },
  "Não informado": { icon: Receipt,   gradient: "from-red-500/20 to-red-700/10" },
  "Outros":        { icon: DollarSign, gradient: "from-zinc-500/20 to-zinc-700/10" },
};

export function POSGeneralDashboard({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"overview" | "payroll" | "fiscal">("overview");
  const [syncing, setSyncing] = useState(false);
  const [period, setPeriod] = useState<Period>("month");
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pickedMonth, setPickedMonth] = useState<Date>(startOfMonth(subMonths(new Date(), 1)));
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState<number>(subMonths(new Date(), 1).getFullYear());
  const [goalsDialogOpen, setGoalsDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [salesRows, setSalesRows] = useState<any[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [paymentModal, setPaymentModal] = useState<{ open: boolean; bucket: string; storeId?: string | null }>({ open: false, bucket: "", storeId: null });
  const [expandedStore, setExpandedStore] = useState<string | null>(null);

  const periodRange = useMemo(() => {
    const now = new Date();
    if (period === "today") return { start: startOfDay(now), end: endOfDay(now), label: "Hoje", days: 1 };
    if (period === "week") return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfDay(now), label: "Semana", days: 7 };
    if (period === "month_pick") {
      const s = startOfMonth(pickedMonth);
      const e = endOfMonth(pickedMonth);
      return { start: s, end: e, label: format(s, "MMMM 'de' yyyy", { locale: ptBR }), days: differenceInDays(e, s) + 1 };
    }
    if (period === "custom" && customRange?.from) {
      const s = startOfDay(customRange.from);
      const e = endOfDay(customRange.to ?? customRange.from);
      const label = customRange.to
        ? `${format(s, "dd/MM", { locale: ptBR })} – ${format(e, "dd/MM", { locale: ptBR })}`
        : format(s, "dd/MM/yyyy", { locale: ptBR });
      return { start: s, end: e, label, days: differenceInDays(e, s) + 1 };
    }
    const s = startOfMonth(now);
    return { start: s, end: endOfDay(now), label: "Mês", days: differenceInDays(endOfDay(now), s) + 1 };
  }, [period, customRange, pickedMonth]);

  const load = async () => {
    setLoading(true);
    try {
      const startIso = periodRange.start.toISOString();
      const endIso = periodRange.end.toISOString();
      const [storesRes, salesRes, goalsRes] = await Promise.all([
        supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name"),
        supabase.from("pos_sales")
          .select("id, store_id, total, payment_method, shipping_cost, created_at, paid_at, status, sale_type, customer_id, customer_name, revenue_attribution, tiny_order_number, crediario_gateway")
          // PAGO É PAGO: somente vendas efetivamente pagas (completed/paid/pending_sync).
          // `pending_pickup` é aguardando pagamento na retirada (paid_at null) — não é receita.
          // Status de fulfillment (envio/mototaxi/retirada/enviado) ficam em db_orders.stage,
          // então mover card no kanban NÃO remove a venda paga deste dashboard.
          // - usa paid_at quando existir, senão created_at (vendas físicas legadas)
          .in("status", ["completed", "pending_sync", "paid"])
          .neq("revenue_attribution", "site_pickup_only")
          .or(`and(paid_at.gte.${startIso},paid_at.lte.${endIso}),and(paid_at.is.null,created_at.gte.${startIso},created_at.lte.${endIso})`)
          .limit(20000),
        supabase.from("pos_goals").select("id, store_id, goal_value, period, period_start, period_end, goal_type, created_at")
          .eq("is_active", true).is("seller_id", null),
      ]);
      const sales = salesRes.data || [];
      const saleIds = sales.map((s: any) => s.id);

      // Fetch items + product costs in chunks
      const itemsBySale = new Map<string, number>();
      const costBySale = new Map<string, number>();
      if (saleIds.length > 0) {
        const chunk = 500;
        for (let i = 0; i < saleIds.length; i += chunk) {
          const slice = saleIds.slice(i, i + chunk);
          const { data: itemsData } = await supabase
            .from("pos_sale_items")
            .select("sale_id, sku, quantity")
            .in("sale_id", slice);
          const skus = Array.from(new Set((itemsData || []).map(it => it.sku).filter(Boolean))) as string[];
          let costBySku = new Map<string, number>();
          if (skus.length > 0) {
            // chunk SKU lookups too
            for (let j = 0; j < skus.length; j += 500) {
              const skuSlice = skus.slice(j, j + 500);
              const { data: prods } = await supabase
                .from("pos_products")
                .select("sku, cost_price")
                .in("sku", skuSlice);
              for (const p of (prods || [])) {
                if (p.sku) costBySku.set(p.sku, Number(p.cost_price || 0));
              }
            }
          }
          for (const it of (itemsData || [])) {
            const q = Number(it.quantity || 0);
            itemsBySale.set(it.sale_id, (itemsBySale.get(it.sale_id) || 0) + q);
            const c = it.sku ? (costBySku.get(it.sku) || 0) : 0;
            costBySale.set(it.sale_id, (costBySale.get(it.sale_id) || 0) + c * q);
          }
        }
      }

      // Enrich missing customer_name via pos_customers lookup
      const missingCustIds = Array.from(new Set(
        sales.filter((s: any) => s.customer_id && !s.customer_name).map((s: any) => s.customer_id)
      ));
      const nameById = new Map<string, string>();
      if (missingCustIds.length > 0) {
        for (let i = 0; i < missingCustIds.length; i += 500) {
          const slice = missingCustIds.slice(i, i + 500);
          const { data: custs } = await supabase
            .from("pos_customers").select("id, name").in("id", slice);
          for (const c of (custs || [])) if (c.id && c.name) nameById.set(c.id, c.name);
        }
      }

      setStores(storesRes.data || []);
      setSalesRows(sales.map((s: any) => ({
        ...s,
        customer_name: s.customer_name || (s.customer_id ? nameById.get(s.customer_id) : null) || null,
        items: itemsBySale.get(s.id) || 0,
        productCost: costBySale.get(s.id) || 0,
      })));
      setGoals((goalsRes.data || []) as any);
    } catch (e: any) {
      toast.error("Erro ao carregar: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Espera o usuário escolher as duas datas no modo personalizado
    if (period === "custom" && !customRange?.from) return;
    load();
    /* eslint-disable-next-line */
  }, [period, customRange?.from, customRange?.to, pickedMonth]);

  const storeData: StoreData[] = useMemo(() => {
    return stores.map(s => {
      const rows = salesRows.filter(r => r.store_id === s.id);
      const revenue = rows.reduce((a, r) => a + Number(r.total || 0), 0);
      const sales = rows.length;
      const items = rows.reduce((a, r) => a + Number(r.items || 0), 0);
      const cost = rows.reduce((a, r) => a + Number(r.productCost || 0), 0);
      const shippingCost = rows.reduce((a, r) => a + Number(r.shipping_cost || 0), 0);
      return {
        id: s.id, name: s.name, revenue, sales, items, cost, shippingCost,
        ticket: sales > 0 ? revenue / sales : 0,
        itemsPerSale: sales > 0 ? items / sales : 0,
      };
    });
  }, [stores, salesRows]);

  const totals = useMemo(() => {
    const revenue = storeData.reduce((a, s) => a + s.revenue, 0);
    const sales = storeData.reduce((a, s) => a + s.sales, 0);
    const items = storeData.reduce((a, s) => a + s.items, 0);
    const cost = storeData.reduce((a, s) => a + s.cost, 0);
    const shippingCost = storeData.reduce((a, s) => a + s.shippingCost, 0);
    const grossMargin = revenue - cost - shippingCost;
    return {
      revenue, sales, items, cost, shippingCost, grossMargin,
      marginPct: revenue > 0 ? (grossMargin / revenue) * 100 : 0,
      ticket: sales > 0 ? revenue / sales : 0,
      itemsPerSale: sales > 0 ? items / sales : 0,
    };
  }, [storeData]);

  // Faturamento Live = recorte das vendas sale_type='live'. É um SUBCONJUNTO do
  // Faturamento total (mesmas linhas de pos_sales) — não soma por cima.
  const liveRevenue = useMemo(
    () => salesRows.filter(r => (r.sale_type || "").toLowerCase() === "live")
      .reduce((a, r) => a + Number(r.total || 0), 0),
    [salesRows]
  );

  // Payment buckets
  const paymentBuckets = useMemo(() => {
    const map = new Map<string, { revenue: number; sales: number }>();
    for (const r of salesRows) {
      const b = bucketPayment(r.payment_method, r.sale_type);
      const cur = map.get(b) || { revenue: 0, sales: 0 };
      cur.revenue += Number(r.total || 0);
      cur.sales += 1;
      map.set(b, cur);
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue);
  }, [salesRows]);

  // Storesbyid for modal
  const storesById = useMemo(() => new Map(stores.map(s => [s.id, s.name])), [stores]);

  // Sales filtered by current modal bucket
  const modalSales = useMemo(() => {
    if (!paymentModal.open) return [];
    return salesRows.filter(r =>
      bucketPayment(r.payment_method, r.sale_type) === paymentModal.bucket &&
      (!paymentModal.storeId || r.store_id === paymentModal.storeId)
    );
  }, [paymentModal, salesRows]);

  // Per-store payment breakdown
  const paymentByStore = useMemo(() => {
    const out = new Map<string, { name: string; revenue: number; sales: number }[]>();
    for (const r of salesRows) {
      const list = out.get(r.store_id) || [];
      const b = bucketPayment(r.payment_method, r.sale_type);
      const found = list.find(x => x.name === b);
      if (found) { found.revenue += Number(r.total || 0); found.sales += 1; }
      else list.push({ name: b, revenue: Number(r.total || 0), sales: 1 });
      out.set(r.store_id, list);
    }
    for (const [k, v] of out) out.set(k, v.sort((a, b) => b.revenue - a.revenue));
    return out;
  }, [salesRows]);

  // Goals — current month rule: prefer custom intersecting current month, fallback monthly. Only ONE per store.
  const goalData = useMemo(() => {
    const now = new Date();
    const byStore = new Map<string, number>();
    const byStoreKind = new Map<string, "custom" | "monthly">();

    for (const g of goals) {
      if (g.goal_type !== "revenue") continue;
      let kind: "custom" | "monthly" | null = null;
      if (g.period === "custom" && g.period_start && g.period_end) {
        const ps = parseLocalDate(g.period_start); const pe = parseLocalDate(g.period_end);
        if (!isBefore(now, ps) && !isAfter(now, pe)) kind = "custom";
      } else if (g.period === "monthly") {
        kind = "monthly";
      }
      if (!kind) continue;
      const existingKind = byStoreKind.get(g.store_id);
      // custom prevails over monthly; latest wins within same kind
      if (!existingKind || (existingKind === "monthly" && kind === "custom")) {
        byStore.set(g.store_id, Number(g.goal_value || 0));
        byStoreKind.set(g.store_id, kind);
      }
    }
    const total = Array.from(byStore.values()).reduce((a, b) => a + b, 0);

    // Ritmo por DIAS ÚTEIS (seg-sáb, excluindo domingos e feriados nacionais).
    // Meta diária = meta total ÷ dias úteis do mês de referência.
    const refDate = (period === "month_pick" || period === "custom") ? periodRange.start : now;
    const monthStart = startOfMonth(refDate);
    const monthEnd = endOfMonth(refDate);
    const holidays = getBrazilianHolidays(refDate.getFullYear());
    const totalBusinessDays = countBusinessDays(monthStart, monthEnd, holidays);
    const dailyTarget = totalBusinessDays > 0 ? total / totalBusinessDays : 0;

    // Dias úteis decorridos conforme o período selecionado
    let elapsedStart: Date;
    let elapsedEnd: Date;
    if (period === "month") { elapsedStart = monthStart; elapsedEnd = now; }
    else if (period === "week") { elapsedStart = periodRange.start; elapsedEnd = now; }
    else if (period === "today") { elapsedStart = startOfDay(now); elapsedEnd = now; }
    else { elapsedStart = periodRange.start; elapsedEnd = periodRange.end; } // month_pick / custom
    const elapsedBusinessDays = countBusinessDays(elapsedStart, elapsedEnd, holidays);
    const expected = dailyTarget * elapsedBusinessDays;

    return { byStore, total, expected, dailyTarget, totalBusinessDays, elapsedBusinessDays };
  }, [goals, period, periodRange]);


  const handleSyncShopify = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-sync-to-pos", { body: { days: 365 } });
      if (error) throw error;
      toast.success(`Importadas ${data?.inserted || 0} vendas · ${data?.skipped || 0} já existiam`);
      await load();
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-zinc-100">
      {/* Metallic top bar */}
      <div className="px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 flex items-center gap-3 shadow-lg">
        <Button variant="ghost" size="icon" onClick={onBack} className="text-zinc-300 hover:text-white hover:bg-zinc-800">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-bold flex items-center gap-2 bg-gradient-to-r from-zinc-100 via-white to-zinc-300 bg-clip-text text-transparent">
            <TrendingUp className="h-5 w-5 text-zinc-300" />
            Dashboard Geral — Todas as Lojas
          </h2>
          <p className="text-[11px] text-zinc-500">Faturamento · margem · metas em tempo real</p>
        </div>
        <Select
          value={period}
          onValueChange={v => {
            const p = v as Period;
            setPeriod(p);
            if (p === "custom") setCalendarOpen(true);
            if (p === "month_pick") {
              setPickerYear(pickedMonth.getFullYear());
              setMonthPickerOpen(true);
            }
          }}
        >
          <SelectTrigger className="w-40 h-9 bg-zinc-800 border-zinc-700 text-zinc-100"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Semana</SelectItem>
            <SelectItem value="month">Mês</SelectItem>
            <SelectItem value="month_pick">Meses anteriores</SelectItem>
            <SelectItem value="custom">Personalizado…</SelectItem>
          </SelectContent>
        </Select>
        {period === "month_pick" && (
          <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-9 gap-2 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700 capitalize">
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(pickedMonth, "MMMM 'de' yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3 bg-zinc-900 border-zinc-700 text-zinc-100" align="end">
              <div className="flex items-center justify-between mb-3">
                <Button
                  size="icon" variant="ghost"
                  className="h-7 w-7 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  onClick={() => setPickerYear(y => y - 1)}
                >
                  ‹
                </Button>
                <span className="text-sm font-semibold text-zinc-100">{pickerYear}</span>
                <Button
                  size="icon" variant="ghost"
                  className="h-7 w-7 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  onClick={() => setPickerYear(y => Math.min(y + 1, new Date().getFullYear()))}
                  disabled={pickerYear >= new Date().getFullYear()}
                >
                  ›
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 12 }).map((_, m) => {
                  const d = new Date(pickerYear, m, 1);
                  const isFuture = isAfter(startOfMonth(d), startOfMonth(new Date()));
                  const selected = pickedMonth.getFullYear() === pickerYear && pickedMonth.getMonth() === m;
                  return (
                    <Button
                      key={m}
                      size="sm"
                      variant={selected ? "default" : "ghost"}
                      disabled={isFuture}
                      onClick={() => {
                        setPickedMonth(startOfMonth(d));
                        setMonthPickerOpen(false);
                      }}
                      className={selected
                        ? "h-9 capitalize bg-orange-500 hover:bg-orange-600 text-white"
                        : "h-9 capitalize text-zinc-200 hover:bg-zinc-800 hover:text-white"}
                    >
                      {format(d, "MMM", { locale: ptBR })}
                    </Button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {period === "custom" && (
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-9 gap-2 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700">
                <CalendarIcon className="h-3.5 w-3.5" />
                {customRange?.from
                  ? (customRange.to
                      ? `${format(customRange.from, "dd/MM", { locale: ptBR })} – ${format(customRange.to, "dd/MM", { locale: ptBR })}`
                      : format(customRange.from, "dd/MM/yyyy", { locale: ptBR }))
                  : "Escolher datas"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-zinc-900 border-zinc-700 text-zinc-100" align="end">
              <Calendar
                mode="range"
                selected={customRange}
                onSelect={(r) => {
                  setCustomRange(r);
                  if (r?.from && r?.to) setCalendarOpen(false);
                }}
                numberOfMonths={2}
                locale={ptBR}
                className="pointer-events-auto"
                classNames={{
                  caption_label: "text-sm font-medium text-zinc-100 capitalize",
                  nav_button: "h-7 w-7 bg-transparent p-0 text-zinc-300 hover:text-white opacity-80 hover:opacity-100 border border-zinc-700 rounded-md",
                  head_cell: "text-zinc-400 rounded-md w-9 font-normal text-[0.8rem]",
                  day: "h-9 w-9 p-0 font-normal text-zinc-200 hover:bg-zinc-700 hover:text-white rounded-md aria-selected:opacity-100",
                  day_selected: "bg-orange-500 text-white hover:bg-orange-600 hover:text-white focus:bg-orange-500 focus:text-white",
                  day_today: "bg-zinc-700 text-white",
                  day_outside: "text-zinc-600 opacity-50",
                  day_disabled: "text-zinc-700 opacity-40",
                  day_range_middle: "aria-selected:bg-zinc-700 aria-selected:text-white",
                }}
              />
            </PopoverContent>
          </Popover>
        )}
        <Button size="sm" onClick={() => setGoalsDialogOpen(true)} className="gap-2 bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700">
          <Settings className="h-3.5 w-3.5" /> Metas
        </Button>
        <Button size="sm" onClick={() => setTaskDialogOpen(true)} className="gap-2 bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700">
          <ClipboardList className="h-3.5 w-3.5" /> Tarefas
        </Button>

        <Button size="sm" onClick={handleSyncShopify} disabled={syncing} className="gap-2 bg-gradient-to-r from-zinc-200 to-zinc-400 text-zinc-900 hover:from-white hover:to-zinc-300">
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Sync Shopify
        </Button>
        <Button size="sm" onClick={load} disabled={loading} className="gap-2 bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {/* Tabs: Visão Geral / Folha */}
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-zinc-800">
        {([["overview", "Visão Geral"], ["payroll", "Folha"], ["fiscal", "Fiscal"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              view === id
                ? "bg-zinc-800 text-white border border-zinc-700 border-b-transparent"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "payroll" ? (
        <ScrollArea className="flex-1">
          <POSPayrollTab periodRange={{ start: periodRange.start, end: periodRange.end, label: periodRange.label }} />
        </ScrollArea>
      ) : view === "fiscal" ? (
        <ScrollArea className="flex-1">
          <POSFiscalTab periodRange={{ start: periodRange.start, end: periodRange.end, label: periodRange.label }} />
        </ScrollArea>
      ) : (
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* TOTALS KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <SilverKpi label="Faturamento" value={BRL(totals.revenue)} icon={DollarSign} accent="emerald" />
            <SilverKpi label="Faturamento Live" value={BRL(liveRevenue)} icon={Radio} accent="fuchsia" />
            <SilverKpi label="Nº de vendas" value={totals.sales.toString()} icon={ShoppingBag} accent="orange" />
            <SilverKpi label="Itens vendidos" value={totals.items.toString()} icon={Package} accent="blue" />
            <SilverKpi label="Ticket médio" value={BRL(totals.ticket)} icon={DollarSign} accent="fuchsia" />
            <SilverKpi label="Itens / venda" value={totals.itemsPerSale.toFixed(2)} icon={Package} accent="indigo" />
          </div>
          <p className="text-[11px] text-zinc-500 -mt-2">
            Faturamento Live já está incluído no Faturamento total (não é somado por cima).
          </p>

          {/* SELLER TASK PROGRESS */}
          <Panel title="Progresso de tarefas das vendedoras" icon={ClipboardList}>
            <POSSellerTaskProgress stores={stores} />
          </Panel>

          {/* SELLER LINK PAGE PROGRESS */}
          <Panel title="Captação por Link Page (vendedoras)" icon={QrCode}>
            <POSSellerLinkPageProgress stores={stores} />
          </Panel>


          {/* PAYMENT BREAKDOWN */}
          <Panel title="Faturamento por forma de pagamento" icon={CreditCard}>
            {paymentBuckets.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center py-3">Sem vendas no período</p>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                  {paymentBuckets.map(b => {
                    const style = PAYMENT_STYLE[b.name] || PAYMENT_STYLE["Outros"];
                    const Icon = style.icon;
                    const pct = totals.revenue > 0 ? (b.revenue / totals.revenue) * 100 : 0;
                    return (
                      <button
                        type="button"
                        key={b.name}
                        onClick={() => setPaymentModal({ open: true, bucket: b.name })}
                        className={`text-left bg-gradient-to-br ${style.gradient} border border-zinc-700/60 rounded-lg p-3 backdrop-blur-sm hover:border-zinc-500 hover:scale-[1.02] transition-all cursor-pointer`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className="h-3.5 w-3.5 text-zinc-300" />
                          <span className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold truncate">{b.name}</span>
                        </div>
                        <p className="text-base font-bold text-zinc-100 truncate">{BRL(b.revenue)}</p>
                        <p className="text-[10px] text-zinc-400">{b.sales} vendas · {pct.toFixed(1)}%</p>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-zinc-500 mt-2">
                  Clique em um card para ver as vendas. <span className="text-zinc-400 font-medium">Outros</span> = vendas sem método de pagamento registrado ou métodos não classificados (ex.: Cheque, "Venda Live - Retirada").
                </p>
              </>
            )}
          </Panel>


          {/* COSTS & MARGIN */}
          <Panel title="Custos e margem bruta" icon={TrendingDown}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SilverKpi label="Custo de produto" value={BRL(totals.cost)} icon={Package} accent="rose" />
              <SilverKpi label="Custo de envio" value={BRL(totals.shippingCost)} icon={Receipt} accent="amber" />
              <SilverKpi label="Margem bruta" value={BRL(totals.grossMargin)} icon={TrendingUp} accent="emerald" />
              <SilverKpi label="% Margem" value={`${totals.marginPct.toFixed(1)}%`} icon={TrendingUp} accent="cyan" />
            </div>
            <p className="text-[10px] text-zinc-500 mt-2">
              Custo de produto: somatório de cost_price (pos_products) × quantidade vendida. Outros custos (operacionais, taxas, marketing) serão adicionados sob demanda.
            </p>
          </Panel>

          {/* GOAL CONSOLIDATED */}
          {goalData.total > 0 && (
            <Panel title={`Meta consolidada — ${periodRange.label}`} icon={Target}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <GoalBox label="Meta total" value={BRL(goalData.total)} sub={`Meta/dia: ${BRL(goalData.dailyTarget)} · ${goalData.totalBusinessDays} dias úteis`} />
                <GoalBox label="Esperado até hoje" value={BRL(goalData.expected)} sub={`${goalData.elapsedBusinessDays}/${goalData.totalBusinessDays} dias úteis decorridos`} />
                <GoalBox label="Realizado" value={BRL(totals.revenue)}
                  sub={`${goalData.expected > 0 ? ((totals.revenue / goalData.expected) * 100).toFixed(0) : 0}% do esperado`}
                  highlight={totals.revenue >= goalData.expected ? "ahead" : "behind"} />
              </div>
              <div className="mt-3">
                <Progress value={Math.min(100, (totals.revenue / goalData.total) * 100)} className="h-2 bg-zinc-800" />
              </div>
            </Panel>
          )}

          {/* PER STORE */}
          <Panel title="Detalhamento por Loja" icon={Store}>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-zinc-400">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
              </div>
            ) : storeData.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-6">Nenhuma loja ativa</p>
            ) : (
              <div className="space-y-3">
                {storeData.map(s => {
                  const goal = goalData.byStore.get(s.id) || 0;
                  const pct = goal > 0 ? Math.min(100, (s.revenue / goal) * 100) : 0;
                  const margin = s.revenue - s.cost - s.shippingCost;
                  const marginPct = s.revenue > 0 ? (margin / s.revenue) * 100 : 0;
                  const payments = paymentByStore.get(s.id) || [];
                  const expanded = expandedStore === s.id;
                  return (
                    <div key={s.id} className="bg-gradient-to-br from-zinc-800/80 to-zinc-900/80 border border-zinc-700/60 rounded-lg p-3 shadow-md">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-gradient-to-br from-zinc-300 to-zinc-500 text-zinc-900 shadow-inner">
                          <Store className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-zinc-100">{s.name}</h4>
                          <p className="text-[11px] text-zinc-400">{s.sales} vendas · {s.items} itens · margem {BRL(margin)} ({marginPct.toFixed(1)}%)</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-emerald-400">{BRL(s.revenue)}</p>
                          {goal > 0 && (
                            <Badge variant="outline" className="text-[10px] border-zinc-600 text-zinc-300 bg-zinc-900/40">
                              {pct.toFixed(0)}% · {BRL(goal)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-[11px] mt-2">
                        <MiniStat label="Ticket" value={BRL(s.ticket)} />
                        <MiniStat label="Itens/venda" value={s.itemsPerSale.toFixed(2)} />
                        <MiniStat label="Custo prod." value={BRL(s.cost)} />
                        <MiniStat label="% do total" value={`${totals.revenue > 0 ? ((s.revenue / totals.revenue) * 100).toFixed(1) : 0}%`} />
                      </div>
                      {goal > 0 && <Progress value={pct} className="h-1.5 mt-2 bg-zinc-800" />}

                      <button
                        type="button"
                        onClick={() => setExpandedStore(expanded ? null : s.id)}
                        className="mt-3 text-[11px] text-zinc-300 hover:text-white underline underline-offset-2"
                      >
                        {expanded ? "▾ Ocultar detalhamento" : "▸ Ver pagamentos e custos"}
                      </button>

                      {expanded && (
                        <div className="mt-3 space-y-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1.5">Formas de pagamento</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {payments.length === 0 && <p className="text-[11px] text-zinc-500">Sem dados</p>}
                              {payments.map(p => {
                                const style = PAYMENT_STYLE[p.name] || PAYMENT_STYLE["Outros"];
                                const Icon = style.icon;
                                const pp = s.revenue > 0 ? (p.revenue / s.revenue) * 100 : 0;
                                return (
                                  <button
                                    key={p.name}
                                    type="button"
                                    onClick={() => setPaymentModal({ open: true, bucket: p.name, storeId: s.id })}
                                    className={`text-left bg-gradient-to-br ${style.gradient} border border-zinc-700/60 rounded p-2 hover:border-zinc-500 transition-colors`}
                                  >
                                    <div className="flex items-center gap-1 mb-0.5">
                                      <Icon className="h-3 w-3 text-zinc-300" />
                                      <span className="text-[9px] uppercase text-zinc-400 font-semibold truncate">{p.name}</span>
                                    </div>
                                    <p className="text-[12px] font-bold text-zinc-100">{BRL(p.revenue)}</p>
                                    <p className="text-[9px] text-zinc-400">{p.sales} · {pp.toFixed(1)}%</p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1.5">Custos e margem</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                              <MiniStat label="Custo produto" value={BRL(s.cost)} />
                              <MiniStat label="Custo envio" value={BRL(s.shippingCost)} />
                              <MiniStat label="Margem bruta" value={BRL(margin)} />
                              <MiniStat label="% Margem" value={`${marginPct.toFixed(1)}%`} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </ScrollArea>
      )}

      <POSGoalsManagerDialog open={goalsDialogOpen} onClose={() => setGoalsDialogOpen(false)} onSaved={load} />
      <POSTaskManagerDialog open={taskDialogOpen} onClose={() => setTaskDialogOpen(false)} stores={stores} />


      <POSPaymentSalesModal
        open={paymentModal.open}
        onClose={() => setPaymentModal({ open: false, bucket: "", storeId: null })}
        title={`Vendas — ${paymentModal.bucket}${paymentModal.storeId ? ` · ${storesById.get(paymentModal.storeId) || ""}` : ""}`}
        bucketName={paymentModal.bucket}
        sales={modalSales}
        storesById={storesById}
        onUpdated={load}
      />
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: any }) {
  return (
    <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-950/90 border border-zinc-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2 text-zinc-100">
        <Icon className="h-4 w-4 text-zinc-300" /> {title}
      </h3>
      {children}
    </div>
  );
}

const ACCENT_COLORS: Record<string, string> = {
  emerald: "text-emerald-400",
  orange:  "text-orange-400",
  blue:    "text-blue-400",
  fuchsia: "text-fuchsia-400",
  indigo:  "text-indigo-400",
  rose:    "text-rose-400",
  amber:   "text-amber-400",
  cyan:    "text-cyan-400",
};

function SilverKpi({ label, value, icon: Icon, accent }: { label: string; value: string; icon: any; accent: string }) {
  const color = ACCENT_COLORS[accent] || "text-zinc-200";
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-zinc-800/80 via-zinc-900/90 to-black border border-zinc-700/60 rounded-lg p-3 shadow-md">
      <div className="absolute inset-0 bg-gradient-to-tr from-white/5 via-transparent to-transparent pointer-events-none" />
      <div className="relative flex items-center gap-2 mb-1">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">{label}</span>
      </div>
      <p className={`relative text-xl font-bold ${color} drop-shadow`}>{value}</p>
    </div>
  );
}

function GoalBox({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "ahead" | "behind" }) {
  const color = highlight === "ahead" ? "text-emerald-400" : highlight === "behind" ? "text-amber-400" : "text-zinc-100";
  return (
    <div className="bg-gradient-to-br from-zinc-800/60 to-zinc-900/60 border border-zinc-700/60 rounded-lg p-3">
      <p className="text-[10px] uppercase font-semibold text-zinc-400">{label}</p>
      <p className={`text-2xl font-bold ${color} drop-shadow`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center bg-zinc-950/60 rounded p-1.5 border border-zinc-800">
      <p className="text-zinc-500 text-[10px]">{label}</p>
      <p className="font-bold text-zinc-100 text-[12px]">{value}</p>
    </div>
  );
}
