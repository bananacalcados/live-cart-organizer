import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3, Home, TrendingUp, DollarSign, Package, ShoppingCart, Store,
  ArrowUpRight, ArrowDownRight, Calendar, Filter, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from "recharts";
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";

interface SaleRow {
  id: string;
  store_id: string;
  total: number;
  subtotal: number;
  discount: number;
  payment_method: string;
  status: string;
  created_at: string;
}

interface SaleItemRow {
  id: string;
  sale_id: string;
  product_name: string;
  variant_name: string | null;
  category: string | null;
  unit_price: number;
  quantity: number;
  total_price: number;
}

interface ExpeditionOrder {
  id: string;
  shopify_order_name: string | null;
  total_price: number | null;
  subtotal_price: number | null;
  total_shipping: number | null;
  total_discount: number | null;
  financial_status: string;
  expedition_status: string;
  created_at: string;
  customer_name: string | null;
}

interface StoreRow {
  id: string;
  name: string;
}

interface ProductRow {
  id: string;
  store_id: string;
  name: string;
  variant: string | null;
  category: string | null;
  price: number;
  stock: number;
}

const CHART_COLORS = [
  "hsl(48, 95%, 50%)", "hsl(25, 90%, 52%)", "hsl(200, 80%, 50%)",
  "hsl(145, 65%, 42%)", "hsl(280, 60%, 55%)", "hsl(0, 70%, 50%)",
  "hsl(185, 60%, 40%)", "hsl(45, 90%, 50%)"
];

type Period = "today" | "7d" | "30d" | "month" | "last_month";

export default function Management() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("30d");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const [sales, setSales] = useState<SaleRow[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItemRow[]>([]);
  const [expeditionOrders, setExpeditionOrders] = useState<ExpeditionOrder[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (period) {
      case "today": return { start: startOfDay(now), end: endOfDay(now) };
      case "7d": return { start: startOfDay(subDays(now, 7)), end: endOfDay(now) };
      case "30d": return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
      case "month": return { start: startOfMonth(now), end: endOfMonth(now) };
      case "last_month": { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
    }
  }, [period]);

  const fetchData = async () => {
    setLoading(true);
    const iso = { start: dateRange.start.toISOString(), end: dateRange.end.toISOString() };

    const [salesRes, itemsRes, expRes, storesRes, prodsRes] = await Promise.all([
      supabase.from("pos_sales").select("id, store_id, total, subtotal, discount, payment_method, status, created_at")
        .gte("created_at", iso.start).lte("created_at", iso.end).eq("status", "completed"),
      supabase.from("pos_sale_items").select("id, sale_id, product_name, variant_name, category, unit_price, quantity, total_price"),
      supabase.from("expedition_orders").select("id, shopify_order_name, total_price, subtotal_price, total_shipping, total_discount, financial_status, expedition_status, created_at, customer_name")
        .gte("created_at", iso.start).lte("created_at", iso.end),
      supabase.from("pos_stores").select("id, name").eq("is_active", true),
      supabase.from("pos_products").select("id, store_id, name, variant, category, price, stock").eq("is_active", true),
    ]);

    setSales(salesRes.data || []);
    setSaleItems(itemsRes.data || []);
    setExpeditionOrders(expRes.data || []);
    setStores(storesRes.data || []);
    setProducts(prodsRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [period]);

  // --- Computed ---
  const filteredSales = useMemo(() => {
    if (storeFilter === "all") return sales;
    return sales.filter(s => s.store_id === storeFilter);
  }, [sales, storeFilter]);

  const filteredSaleIds = useMemo(() => new Set(filteredSales.map(s => s.id)), [filteredSales]);
  const filteredItems = useMemo(() => saleItems.filter(i => filteredSaleIds.has(i.sale_id)), [saleItems, filteredSaleIds]);

  const shopifyPaidOrders = useMemo(() => expeditionOrders.filter(o => o.financial_status === "paid"), [expeditionOrders]);

  // KPIs
  const posTotalRevenue = filteredSales.reduce((s, v) => s + Number(v.total || 0), 0);
  const posItemsSold = filteredItems.reduce((s, v) => s + v.quantity, 0);
  const posTicketMedio = filteredSales.length > 0 ? posTotalRevenue / filteredSales.length : 0;
  const posDiscount = filteredSales.reduce((s, v) => s + Number(v.discount || 0), 0);

  const shopifyRevenue = shopifyPaidOrders.reduce((s, o) => s + Number(o.total_price || 0), 0);
  const shopifyShipping = shopifyPaidOrders.reduce((s, o) => s + Number(o.total_shipping || 0), 0);
  const shopifyDiscount = shopifyPaidOrders.reduce((s, o) => s + Number(o.total_discount || 0), 0);

  const totalRevenue = posTotalRevenue + shopifyRevenue;
  const totalOrders = filteredSales.length + shopifyPaidOrders.length;

  // Top products
  const productRanking = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    filteredItems.forEach(i => {
      const key = i.product_name + (i.variant_name ? ` - ${i.variant_name}` : "");
      const cur = map.get(key) || { name: key, qty: 0, revenue: 0 };
      cur.qty += i.quantity;
      cur.revenue += Number(i.total_price);
      map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  }, [filteredItems]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredItems.forEach(i => {
      const cat = i.category || "Sem categoria";
      map.set(cat, (map.get(cat) || 0) + Number(i.total_price));
    });
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredItems]);

  // Payment methods
  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredSales.forEach(s => {
      const m = s.payment_method || "Outros";
      map.set(m, (map.get(m) || 0) + Number(s.total));
    });
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredSales]);

  // Daily trend
  const dailyTrend = useMemo(() => {
    const map = new Map<string, { pos: number; shopify: number }>();
    filteredSales.forEach(s => {
      const day = format(new Date(s.created_at), "dd/MM");
      const cur = map.get(day) || { pos: 0, shopify: 0 };
      cur.pos += Number(s.total);
      map.set(day, cur);
    });
    shopifyPaidOrders.forEach(o => {
      const day = format(new Date(o.created_at), "dd/MM");
      const cur = map.get(day) || { pos: 0, shopify: 0 };
      cur.shopify += Number(o.total_price || 0);
      map.set(day, cur);
    });
    return [...map.entries()].map(([date, v]) => ({ date, ...v, total: v.pos + v.shopify })).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredSales, shopifyPaidOrders]);

  // Store comparison
  const storeComparison = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; orders: number }>();
    stores.forEach(st => map.set(st.id, { name: st.name, revenue: 0, orders: 0 }));
    sales.forEach(s => {
      const cur = map.get(s.store_id);
      if (cur) { cur.revenue += Number(s.total); cur.orders++; }
    });
    // Add Shopify as a virtual store
    const shopifyData = { name: "Shopify (Online)", revenue: shopifyRevenue, orders: shopifyPaidOrders.length };
    return [...map.values(), shopifyData].filter(s => s.orders > 0).sort((a, b) => b.revenue - a.revenue);
  }, [sales, stores, shopifyRevenue, shopifyPaidOrders]);

  // Inventory summary
  const inventorySummary = useMemo(() => {
    const byStore = new Map<string, { name: string; totalItems: number; totalValue: number; zeroStock: number }>();
    stores.forEach(st => byStore.set(st.id, { name: st.name, totalItems: 0, totalValue: 0, zeroStock: 0 }));
    products.forEach(p => {
      const cur = byStore.get(p.store_id);
      if (cur) {
        cur.totalItems += Number(p.stock || 0);
        cur.totalValue += Number(p.stock || 0) * Number(p.price || 0);
        if (Number(p.stock) <= 0) cur.zeroStock++;
      }
    });
    return [...byStore.values()];
  }, [products, stores]);

  const totalStockValue = inventorySummary.reduce((s, v) => s + v.totalValue, 0);
  const totalZeroStock = inventorySummary.reduce((s, v) => s + v.zeroStock, 0);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <BarChart3 className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-bold">Gestão</h1>
          </div>
          <div className="flex items-center gap-2">
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="Todas as lojas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as lojas</SelectItem>
                {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="month">Mês atual</SelectItem>
                <SelectItem value="last_month">Mês passado</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={fetchData} className="h-8 w-8"><RefreshCw className="h-4 w-4" /></Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 h-8"><Home className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container py-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando dados...</div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <KPICard title="Faturamento Total" value={fmt(totalRevenue)} icon={DollarSign} />
              <KPICard title="Vendas Lojas" value={fmt(posTotalRevenue)} icon={Store} sub={`${filteredSales.length} vendas`} />
              <KPICard title="Vendas Shopify" value={fmt(shopifyRevenue)} icon={ShoppingCart} sub={`${shopifyPaidOrders.length} pedidos`} />
              <KPICard title="Ticket Médio" value={fmt(totalOrders > 0 ? totalRevenue / totalOrders : 0)} icon={TrendingUp} />
              <KPICard title="Itens Vendidos (Loja)" value={posItemsSold.toString()} icon={Package} />
              <KPICard title="Descontos" value={fmt(posDiscount + shopifyDiscount)} icon={ArrowDownRight} variant="destructive" />
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">Visão Geral</TabsTrigger>
                <TabsTrigger value="products">Produtos</TabsTrigger>
                <TabsTrigger value="stores">Lojas</TabsTrigger>
                <TabsTrigger value="inventory">Estoque</TabsTrigger>
              </TabsList>

              {/* Overview */}
              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card className="lg:col-span-2">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Faturamento Diário</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={dailyTrend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                          <Tooltip formatter={(v: number) => fmt(v)} />
                          <Legend />
                          <Bar dataKey="pos" name="Lojas" fill="hsl(48, 95%, 50%)" radius={[4,4,0,0]} />
                          <Bar dataKey="shopify" name="Shopify" fill="hsl(25, 90%, 52%)" radius={[4,4,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Pagamentos (Lojas)</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie data={paymentBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                            {paymentBreakdown.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmt(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>

                {/* Store comparison */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Comparativo por Canal</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={storeComparison} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => fmt(v)} />
                        <Bar dataKey="revenue" name="Faturamento" fill="hsl(48, 95%, 50%)" radius={[0,4,4,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Products */}
              <TabsContent value="products" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Top Produtos (Lojas)</CardTitle></CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Produto</TableHead>
                            <TableHead className="text-right">Qtd</TableHead>
                            <TableHead className="text-right">Receita</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {productRanking.map((p, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-bold text-primary">{i + 1}</TableCell>
                              <TableCell className="max-w-[200px] truncate text-xs">{p.name}</TableCell>
                              <TableCell className="text-right">{p.qty}</TableCell>
                              <TableCell className="text-right font-semibold">{fmt(p.revenue)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Receita por Categoria</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={350}>
                        <PieChart>
                          <Pie data={categoryBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={120} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                            {categoryBreakdown.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmt(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Stores */}
              <TabsContent value="stores" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {storeComparison.map((sc, i) => (
                    <Card key={i}>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Store className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold">{sc.name}</h3>
                            <p className="text-xs text-muted-foreground">{sc.orders} vendas no período</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Faturamento</span>
                            <span className="font-bold">{fmt(sc.revenue)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Ticket Médio</span>
                            <span className="font-semibold">{sc.orders > 0 ? fmt(sc.revenue / sc.orders) : "—"}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              {/* Inventory */}
              <TabsContent value="inventory" className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <KPICard title="Valor em Estoque" value={fmt(totalStockValue)} icon={Package} />
                  <KPICard title="Produtos Zerados" value={totalZeroStock.toString()} icon={ArrowDownRight} variant="destructive" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {inventorySummary.map((inv, i) => (
                    <Card key={i}>
                      <CardContent className="pt-6">
                        <h3 className="font-semibold mb-3">{inv.name}</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Itens em estoque</span>
                            <span className="font-bold">{inv.totalItems.toLocaleString("pt-BR")}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Valor estimado</span>
                            <span className="font-semibold">{fmt(inv.totalValue)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Produtos zerados</span>
                            <Badge variant={inv.zeroStock > 0 ? "destructive" : "secondary"}>{inv.zeroStock}</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}

function KPICard({ title, value, icon: Icon, sub, variant }: { title: string; value: string; icon: any; sub?: string; variant?: "destructive" }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted-foreground font-medium">{title}</span>
          <Icon className={`h-3.5 w-3.5 ${variant === "destructive" ? "text-destructive" : "text-primary"}`} />
        </div>
        <p className={`text-lg font-bold ${variant === "destructive" ? "text-destructive" : ""}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}
