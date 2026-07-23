import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DbOrderProduct, DiscountType } from "@/types/database";
import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";
import {
  DollarSign, TrendingUp, Package, ShoppingCart, Receipt,
  CheckCircle, AlertCircle, BarChart3, Calendar as CalendarIcon, Store
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, endOfYear, subMonths, format
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { EventBuyerOriginMatrix } from "./EventBuyerOriginMatrix";

type PeriodFilter = "day" | "week" | "month" | "quarter" | "semester" | "year" | "custom";
type StoreFilter = "all" | "site" | "pos_perola" | "pos_centro";

interface OrderRow {
  id: string;
  event_id: string;
  products: DbOrderProduct[];
  is_paid: boolean;
  paid_externally: boolean;
  paid_at: string | null;
  stage: string;
  discount_type: DiscountType | null;
  discount_value: number | null;
  shipping_cost: number | null;
  free_shipping: boolean | null;
  created_at: string;
  event_name: string;
}

// Freight received on a paid order (0 when free shipping).
const calculateOrderFreight = (order: OrderRow) => {
  if (order.free_shipping) return 0;
  return Number(order.shipping_cost || 0);
};

const calculateOrderValue = (order: OrderRow) => {
  const subtotal = order.products.reduce((s, p) => s + p.price * p.quantity, 0);
  if (order.discount_type && order.discount_value) {
    const discount = order.discount_type === "percentage"
      ? subtotal * (order.discount_value / 100)
      : order.discount_value;
    return Math.max(0, subtotal - discount);
  }
  return subtotal;
};

const calculateItemCount = (order: OrderRow) =>
  order.products.reduce((s, p) => s + p.quantity, 0);

const getDateRange = (filter: PeriodFilter, customFrom?: string, customTo?: string): [Date, Date] => {
  const now = new Date();
  switch (filter) {
    case "day": return [startOfDay(now), endOfDay(now)];
    case "week": return [startOfWeek(now, { weekStartsOn: 1 }), endOfWeek(now, { weekStartsOn: 1 })];
    case "month": return [startOfMonth(now), endOfMonth(now)];
    case "quarter": return [startOfQuarter(now), endOfQuarter(now)];
    case "semester": return [subMonths(startOfMonth(now), 5), endOfMonth(now)];
    case "year": return [startOfYear(now), endOfYear(now)];
    case "custom":
      return [
        customFrom ? startOfDay(new Date(customFrom)) : startOfMonth(now),
        customTo ? endOfDay(new Date(customTo)) : endOfDay(now),
      ];
  }
};

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  day: "Hoje",
  week: "Semana",
  month: "Mês",
  quarter: "Trimestre",
  semester: "Semestre",
  year: "Ano",
  custom: "Período",
};

const STORE_LABELS: Record<StoreFilter, string> = {
  all: "Todas as lojas",
  site: "Site",
  pos_perola: "Loja Pérola",
  pos_centro: "Loja Centro",
};

export function EventsDashboard() {
  const [period, setPeriod] = useState<PeriodFilter>("month");
  const [store, setStore] = useState<StoreFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventCount, setEventCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [from, to] = getDateRange(period, customFrom, customTo);

      // Fetch events in range using start_date (data configurada do evento)
      // com fallback para created_at quando start_date não estiver definido.
      const fromIso = from.toISOString();
      const toIso = to.toISOString();
      let eventsQuery = supabase
        .from("events")
        .select("id, name, channel, created_at, start_date")
        .or(
          `and(start_date.gte.${fromIso},start_date.lte.${toIso}),` +
          `and(start_date.is.null,created_at.gte.${fromIso},created_at.lte.${toIso})`
        );
      if (store !== "all") eventsQuery = eventsQuery.eq("channel", store);
      const { data: eventsData } = await eventsQuery;

      const eventIds = (eventsData || []).map((e) => e.id);
      const eventNameMap = Object.fromEntries((eventsData || []).map((e) => [e.id, e.name]));
      setEventCount(eventIds.length);

      if (eventIds.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }

      const { data: ordersData } = await supabase
        .from("orders")
        .select("id, event_id, products, is_paid, paid_externally, paid_at, stage, discount_type, discount_value, shipping_cost, free_shipping, created_at")
        .in("event_id", eventIds);

      const parsed = (ordersData || []).map((o: any) => ({
        ...o,
        products: (o.products || []) as DbOrderProduct[],
        discount_type: o.discount_type as DiscountType | null,
        event_name: eventNameMap[o.event_id] || "—",
      }));

      setOrders(parsed);
      setLoading(false);
    };
    fetchData();
  }, [period, store, customFrom, customTo]);

  const metrics = useMemo(() => {
    const total = orders.length;
    const paid = orders.filter((o) => isOrderMarkedPaid(o));
    const paidCount = paid.length;
    const unpaidCount = total - paidCount;

    const totalValue = orders.reduce((s, o) => s + calculateOrderValue(o), 0);
    const receivedValue = paid.reduce((s, o) => s + calculateOrderValue(o), 0);
    // "Recebido (sem frete)" = valor de produtos recebido, descontando o frete pago.
    const freightReceived = paid.reduce((s, o) => s + calculateOrderFreight(o), 0);
    const receivedNoFreight = Math.max(0, receivedValue - freightReceived);

    const totalItems = orders.reduce((s, o) => s + calculateItemCount(o), 0);
    const avgTicket = total > 0 ? totalValue / total : 0;
    const avgItems = total > 0 ? totalItems / total : 0;
    const conversion = total > 0 ? (paidCount / total) * 100 : 0;

    // Per-event chart data
    const byEvent: Record<string, { name: string; total: number; received: number; orders: number }> = {};
    for (const o of orders) {
      if (!byEvent[o.event_id]) {
        byEvent[o.event_id] = { name: o.event_name, total: 0, received: 0, orders: 0 };
      }
      const val = calculateOrderValue(o);
      byEvent[o.event_id].total += val;
      byEvent[o.event_id].orders += 1;
        if (isOrderMarkedPaid(o)) byEvent[o.event_id].received += val;
    }
    const chartData = Object.values(byEvent).sort((a, b) => b.total - a.total);

    return { total, paidCount, unpaidCount, totalValue, receivedValue, receivedNoFreight, freightReceived, avgTicket, avgItems, totalItems, conversion, chartData };
  }, [orders]);

  const kpis = [
    { label: "Qtde de Lives", value: eventCount, icon: CalendarIcon, color: "text-primary", bg: "bg-primary/10" },
    { label: "Total de Pedidos", value: metrics.total, icon: Package, color: "text-primary", bg: "bg-primary/10" },
    { label: "Pagos", value: metrics.paidCount, icon: CheckCircle, color: "text-stage-paid", bg: "bg-stage-paid/10" },
    { label: "Não Pagos", value: metrics.unpaidCount, icon: AlertCircle, color: "text-stage-awaiting", bg: "bg-stage-awaiting/10" },
    { label: "Faturamento Total", value: `R$ ${metrics.totalValue.toFixed(2)}`, icon: Receipt, color: "text-accent", bg: "bg-accent/10" },
    { label: "Faturamento Recebido", value: `R$ ${metrics.receivedValue.toFixed(2)}`, icon: DollarSign, color: "text-stage-paid", bg: "bg-stage-paid/10" },
    { label: "Recebido s/ frete", value: `R$ ${metrics.receivedNoFreight.toFixed(2)}`, icon: DollarSign, color: "text-stage-paid", bg: "bg-stage-paid/10" },
    { label: "Frete Recebido", value: `R$ ${metrics.freightReceived.toFixed(2)}`, icon: Receipt, color: "text-muted-foreground", bg: "bg-muted" },
    { label: "Ticket Médio", value: `R$ ${metrics.avgTicket.toFixed(2)}`, icon: ShoppingCart, color: "text-primary", bg: "bg-primary/10" },
    { label: "Itens / Venda", value: metrics.avgItems.toFixed(1), icon: TrendingUp, color: "text-accent", bg: "bg-accent/10" },
    { label: "Total de Itens", value: metrics.totalItems, icon: BarChart3, color: "text-primary", bg: "bg-primary/10" },
    { label: "Conversão", value: `${metrics.conversion.toFixed(0)}%`, icon: TrendingUp, color: "text-stage-contacted", bg: "bg-stage-contacted/10" },
  ];

  return (
    <div className="mb-6 space-y-4">
      {/* Period Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PERIOD_LABELS) as PeriodFilter[]).map((p) => (
          <Button
            key={p}
            variant={period === p ? "default" : "outline"}
            size="sm"
            onClick={() => setPeriod(p)}
            className={period === p ? "btn-accent" : ""}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>

      {/* Store Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
          <Store className="h-3.5 w-3.5" /> Loja:
        </div>
        {(Object.keys(STORE_LABELS) as StoreFilter[]).map((s) => (
          <Button
            key={s}
            variant={store === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStore(s)}
            className={store === s ? "btn-accent" : ""}
          >
            {STORE_LABELS[s]}
          </Button>
        ))}
      </div>

      {period === "custom" && (
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
          </div>
        </div>
      )}

      {/* KPI Cards */}
      {loading ? (
        <div className="text-center py-6 text-muted-foreground">Carregando dashboard...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {kpis.map((kpi) => (
              <Card key={kpi.label} className="border-border/50 shadow-card">
                <CardContent className="p-3 flex items-center gap-2">
                  <div className={`p-2 rounded-lg ${kpi.bg}`}>
                    <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-foreground truncate">{kpi.value}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{kpi.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Chart */}
          {metrics.chartData.length > 0 && (
            <Card className="border-border/50 shadow-card">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3 text-foreground">Faturamento por Live</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metrics.chartData} margin={{ top: 5, right: 20, left: 0, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10 }}
                        angle={-30}
                        textAnchor="end"
                        className="fill-muted-foreground"
                      />
                      <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                      <Tooltip
                        formatter={(value: number) => `R$ ${value.toFixed(2)}`}
                        contentStyle={{ borderRadius: 8, fontSize: 12 }}
                      />
                      <Bar dataKey="total" name="Faturamento Total" fill="hsl(var(--evt-chart-1, var(--primary)))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="received" name="Recebido" fill="hsl(var(--evt-chart-2, var(--muted-foreground)))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Matriz agregada de compradores por origem (todos os eventos do período) */}
          {(() => {
            const [from, to] = getDateRange(period, customFrom, customTo);
            return (
              <EventBuyerOriginMatrix
                range={{
                  from: from.toISOString(),
                  to: to.toISOString(),
                  channel: store === "all" ? null : store,
                }}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}
