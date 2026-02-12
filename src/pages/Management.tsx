import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3, Home, TrendingUp, DollarSign, Package, ShoppingCart, Store,
  ArrowDownRight, RefreshCw, Loader2, Box, ShoppingBag, Calendar, Receipt,
  AlertTriangle, CheckCircle2, Clock
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { toast } from "sonner";

interface TinySyncedOrder {
  id: string;
  store_id: string;
  tiny_order_id: string;
  tiny_order_number: string | null;
  order_date: string;
  customer_name: string | null;
  status: string | null;
  payment_method: string | null;
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  items: any;
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
  shopify_created_at: string | null;
}

interface StoreRow {
  id: string;
  name: string;
}

interface InventorySummaryRow {
  store_id: string;
  total_items: number;
  total_value: number;
  total_cost: number;
  zero_stock: number;
  total_skus: number;
}

const CHART_COLORS = [
  "hsl(0, 0%, 15%)", "hsl(48, 95%, 50%)", "hsl(25, 90%, 52%)",
  "hsl(0, 0%, 35%)", "hsl(48, 80%, 40%)", "hsl(25, 70%, 40%)",
  "hsl(0, 0%, 55%)", "hsl(48, 60%, 60%)"
];

type Period = "today" | "7d" | "30d" | "month" | "last_month" | "custom";

export default function Management() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("30d");
  const [customFrom, setCustomFrom] = useState(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingShopify, setSyncingShopify] = useState(false);
  const [syncingStock, setSyncingStock] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ currentDate: string; storeName: string; phase: string } | null>(null);

  const [tinyOrders, setTinyOrders] = useState<TinySyncedOrder[]>([]);
  const [expeditionOrders, setExpeditionOrders] = useState<ExpeditionOrder[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [inventoryData, setInventoryData] = useState<InventorySummaryRow[]>([]);
  const [accountsPayable, setAccountsPayable] = useState<any[]>([]);
  const [syncingAP, setSyncingAP] = useState(false);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (period) {
      case "today": return { start: startOfDay(now), end: endOfDay(now) };
      case "7d": return { start: startOfDay(subDays(now, 7)), end: endOfDay(now) };
      case "30d": return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
      case "month": return { start: startOfMonth(now), end: endOfMonth(now) };
      case "last_month": { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
      case "custom": return { start: startOfDay(new Date(customFrom + 'T12:00:00')), end: endOfDay(new Date(customTo + 'T12:00:00')) };
    }
  }, [period, customFrom, customTo]);

  const fetchData = async () => {
    setLoading(true);
    const startDate = dateRange.start.toISOString().split('T')[0];
    const endDate = dateRange.end.toISOString().split('T')[0];
    const iso = { start: dateRange.start.toISOString(), end: dateRange.end.toISOString() };

    const [tinyRes, expRes, storesRes, invRes, apRes] = await Promise.all([
      supabase.from("tiny_synced_orders").select("*")
        .gte("order_date", startDate).lte("order_date", endDate),
      supabase.from("expedition_orders").select("id, shopify_order_name, total_price, subtotal_price, total_shipping, total_discount, financial_status, expedition_status, created_at, customer_name, shopify_created_at")
        .gte("shopify_created_at", iso.start).lte("shopify_created_at", iso.end),
      supabase.from("pos_stores").select("id, name").eq("is_active", true),
      supabase.rpc("get_inventory_summary"),
      supabase.from("tiny_accounts_payable").select("*").order("data_vencimento", { ascending: true }),
    ]);

    setTinyOrders((tinyRes.data || []) as unknown as TinySyncedOrder[]);
    setExpeditionOrders(expRes.data || []);
    setStores(storesRes.data || []);
    setInventoryData((invRes.data || []) as unknown as InventorySummaryRow[]);
    setAccountsPayable((apRes.data || []) as any[]);
    setLoading(false);
  };

  const runSyncWithResume = async (body: any) => {
    setSyncing(true);
    setSyncProgress({ currentDate: "Iniciando...", storeName: "", phase: body.stock_only ? "stock" : "orders" });

    const pollInterval = setInterval(async () => {
      const { data: logs } = await supabase
        .from('tiny_management_sync_log')
        .select('orders_synced, status, store_id, current_date_syncing, phase')
        .in('status', ['running', 'partial'])
        .order('started_at', { ascending: false })
        .limit(1);
      if (logs && logs.length > 0) {
        const log = logs[0] as any;
        const storeName = stores.find(s => s.id === log.store_id)?.name || "Loja";
        setSyncProgress({ currentDate: log.current_date_syncing || "Processando...", storeName, phase: log.phase || 'orders' });
      }
    }, 1500);

    try {
      let totalSynced = 0;

      // Sync each store separately to avoid timeout
      const storesToSync = body.store_id ? [body.store_id] : stores.map(s => s.id);

      for (const sid of storesToSync) {
        let currentBody = { ...body, store_id: sid };
        let attempts = 0;
        const MAX_ATTEMPTS = 30;

        while (attempts < MAX_ATTEMPTS) {
          attempts++;
          const { data, error } = await supabase.functions.invoke('tiny-sync-management', { body: currentBody });
          if (error) throw error;

          const partialResults = data?.results || [];
          totalSynced += partialResults.reduce((s: number, r: any) => s + (r.orders_synced || 0), 0);

          const partial = partialResults.find((r: any) => r.status === 'partial');
          if (partial) {
            const stName = stores.find(s => s.id === sid)?.name || "Loja";
            if (partial.resume_stock_page) {
              toast.info(`Continuando estoque ${stName}... (pg ${partial.resume_stock_page})`);
              currentBody = {
                store_id: partial.store_id,
                stock_only: true,
                resume_stock_page: partial.resume_stock_page,
                resume_log_id: partial.resume_log_id,
              };
            } else if (partial.resume_date) {
              toast.info(`Continuando pedidos ${stName}... (${partial.resume_date})`);
              currentBody = {
                ...body,
                store_id: partial.store_id,
                resume_date: partial.resume_date,
                resume_log_id: partial.resume_log_id,
              };
            }
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }

          // Check if orders sync timed out (skipped store means it was cut short)
          const skipped = partialResults.find((r: any) => r.status === 'skipped');
          if (skipped) {
            // Re-run for this store
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }

          break;
        }
      }

      toast.success(`Sincronização concluída: ${totalSynced} pedidos importados`);
      fetchData();
    } catch (e: any) {
      toast.error(`Erro na sincronização: ${e.message}`);
    } finally {
      clearInterval(pollInterval);
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const syncTinyOrders = () => {
    const fromDate = format(dateRange.start, 'dd/MM/yyyy');
    const toDate = format(dateRange.end, 'dd/MM/yyyy');
    runSyncWithResume({ date_from: fromDate, date_to: toDate, sync_stock: false });
  };

  const syncTinyStock = async () => {
    setSyncingStock(true);
    setSyncProgress({ currentDate: "Estoque: Iniciando...", storeName: "", phase: "stock" });

    const pollInterval = setInterval(async () => {
      const { data: logs } = await supabase
        .from('tiny_management_sync_log')
        .select('orders_synced, status, store_id, current_date_syncing, phase')
        .in('status', ['running', 'partial'])
        .order('started_at', { ascending: false })
        .limit(1);
      if (logs && logs.length > 0) {
        const log = logs[0] as any;
        const storeName = stores.find(s => s.id === log.store_id)?.name || "Loja";
        setSyncProgress({ currentDate: log.current_date_syncing || "Processando...", storeName, phase: 'stock' });
      }
    }, 1500);

    try {
      const storesToSync = stores.map(s => s.id);
      for (const sid of storesToSync) {
        let currentBody: any = { stock_only: true, store_id: sid };
        let attempts = 0;
        const MAX_ATTEMPTS = 250;

        while (attempts < MAX_ATTEMPTS) {
          attempts++;
          const { data, error } = await supabase.functions.invoke('tiny-sync-management', { body: currentBody });
          if (error) throw error;

          const partialResults = data?.results || [];
          const partial = partialResults.find((r: any) => r.status === 'partial');
          if (partial?.resume_stock_page) {
            const stName = stores.find(s => s.id === sid)?.name || "Loja";
            const pct = partial.stock_updated && partial.resume_stock_page ? `${Math.round((partial.stock_updated / 5900) * 100)}%` : `pg ${partial.resume_stock_page}`;
            toast.info(`Continuando estoque ${stName}... (${pct})`);
            currentBody = {
              store_id: partial.store_id,
              stock_only: true,
              resume_stock_page: partial.resume_stock_page,
              resume_log_id: partial.resume_log_id,
            };
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          break;
        }
        const stName = stores.find(s => s.id === sid)?.name || "Loja";
        toast.success(`Estoque ${stName} sincronizado`);
      }
      toast.success("Sincronização de estoque concluída!");
      fetchData();
    } catch (e: any) {
      toast.error(`Erro na sincronização de estoque: ${e.message}`);
    } finally {
      clearInterval(pollInterval);
      setSyncingStock(false);
      setSyncProgress(null);
    }
  };

  const syncShopifyOrders = async () => {
    setSyncingShopify(true);
    try {
      // Sync ALL Shopify orders (not just the dashboard filter range)
      // Use a wide date range to capture all historical orders
      const syncStart = new Date('2025-01-01').toISOString();
      const syncEnd = new Date().toISOString();
      const { data, error } = await supabase.functions.invoke('expedition-sync-orders', {
        body: {
          created_at_min: syncStart,
          created_at_max: syncEnd,
        },
      });
      if (error) throw error;
      toast.success(`Shopify sincronizado: ${data?.orders_synced || 0} pedidos`);
      fetchData();
    } catch (e: any) {
      toast.error(`Erro sync Shopify: ${e.message}`);
    } finally {
      setSyncingShopify(false);
    }
  };

  const syncAccountsPayable = async () => {
    setSyncingAP(true);
    try {
      const { data, error } = await supabase.functions.invoke('tiny-sync-accounts-payable', {
        body: storeFilter !== 'all' ? { store_id: storeFilter } : {},
      });
      if (error) throw error;
      const total = (data?.results || []).reduce((s: number, r: any) => s + (r.total_synced || 0), 0);
      toast.success(`Contas a pagar sincronizadas: ${total} contas`);
      fetchData();
    } catch (e: any) {
      toast.error(`Erro ao sincronizar contas a pagar: ${e.message}`);
    } finally {
      setSyncingAP(false);
    }
  };

  useEffect(() => { fetchData(); }, [period]);

  // --- Computed ---
  const filteredTinyOrders = useMemo(() => {
    if (storeFilter === "all") return tinyOrders;
    return tinyOrders.filter(s => s.store_id === storeFilter);
  }, [tinyOrders, storeFilter]);

  const shopifyPaidOrders = useMemo(() => expeditionOrders.filter(o => o.financial_status === "paid"), [expeditionOrders]);

  // Parse items from tiny orders
  const allTinyItems = useMemo(() => {
    const items: { name: string; sku: string; quantity: number; unit_price: number; total: number; store_id: string }[] = [];
    filteredTinyOrders.forEach(order => {
      try {
        const parsed = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
        parsed.forEach((i: any) => items.push({ ...i, store_id: order.store_id }));
      } catch {}
    });
    return items;
  }, [filteredTinyOrders]);

  // KPIs
  const tinyTotalRevenue = filteredTinyOrders.reduce((s, v) => s + Number(v.total || 0), 0);
  const tinyItemsSold = allTinyItems.reduce((s, v) => s + (v.quantity || 0), 0);
  const tinyDiscount = filteredTinyOrders.reduce((s, v) => s + Number(v.discount || 0), 0);

  const shopifyRevenue = shopifyPaidOrders.reduce((s, o) => s + Number(o.total_price || 0), 0);
  const shopifyDiscount = shopifyPaidOrders.reduce((s, o) => s + Number(o.total_discount || 0), 0);

  const totalRevenue = tinyTotalRevenue + shopifyRevenue;
  const totalOrders = filteredTinyOrders.length + shopifyPaidOrders.length;

  // Top products (from Tiny items)
  const productRanking = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    allTinyItems.forEach(i => {
      const key = i.name || i.sku;
      if (!key) return;
      const cur = map.get(key) || { name: key, qty: 0, revenue: 0 };
      cur.qty += i.quantity || 0;
      cur.revenue += i.total || (i.unit_price * i.quantity) || 0;
      map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  }, [allTinyItems]);

  // Payment methods
  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredTinyOrders.forEach(s => {
      const m = s.payment_method || "Outros";
      map.set(m, (map.get(m) || 0) + Number(s.total));
    });
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredTinyOrders]);

  // Daily trend
  const dailyTrend = useMemo(() => {
    const map = new Map<string, { lojas: number; shopify: number }>();
    filteredTinyOrders.forEach(s => {
      const day = s.order_date ? format(new Date(s.order_date + 'T12:00:00'), "dd/MM") : "??";
      const cur = map.get(day) || { lojas: 0, shopify: 0 };
      cur.lojas += Number(s.total);
      map.set(day, cur);
    });
    shopifyPaidOrders.forEach(o => {
      const dateStr = o.shopify_created_at || o.created_at;
      const day = format(new Date(dateStr), "dd/MM");
      const cur = map.get(day) || { lojas: 0, shopify: 0 };
      cur.shopify += Number(o.total_price || 0);
      map.set(day, cur);
    });
    return [...map.entries()].map(([date, v]) => ({ date, ...v, total: v.lojas + v.shopify })).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredTinyOrders, shopifyPaidOrders]);

  // Store comparison
  const storeComparison = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; orders: number }>();
    stores.forEach(st => map.set(st.id, { name: st.name, revenue: 0, orders: 0 }));
    tinyOrders.forEach(s => {
      const cur = map.get(s.store_id);
      if (cur) { cur.revenue += Number(s.total); cur.orders++; }
    });
    const shopifyData = { name: "Shopify (Online)", revenue: shopifyRevenue, orders: shopifyPaidOrders.length };
    return [...map.values(), shopifyData].filter(s => s.orders > 0).sort((a, b) => b.revenue - a.revenue);
  }, [tinyOrders, stores, shopifyRevenue, shopifyPaidOrders]);

  // Inventory summary (from DB function — no row limit)
  const inventorySummary = useMemo(() => {
    return stores.map(st => {
      const inv = inventoryData.find(i => i.store_id === st.id);
      return {
        name: st.name,
        totalItems: Number(inv?.total_items || 0),
        totalValue: Number(inv?.total_value || 0),
        totalCost: Number(inv?.total_cost || 0),
        zeroStock: Number(inv?.zero_stock || 0),
        totalSkus: Number(inv?.total_skus || 0),
      };
    });
  }, [inventoryData, stores]);

  const totalStockValue = inventorySummary.reduce((s, v) => s + v.totalValue, 0);
  const totalStockCost = inventorySummary.reduce((s, v) => s + v.totalCost, 0);
  const totalZeroStock = inventorySummary.reduce((s, v) => s + v.zeroStock, 0);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-[hsl(0,0%,8%)] text-[hsl(45,10%,95%)]">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <BarChart3 className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-bold text-[hsl(45,10%,95%)]">Gestão</h1>
          </div>
          <div className="flex items-center gap-2">
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[160px] h-8 text-xs bg-[hsl(0,0%,15%)] border-[hsl(0,0%,20%)] text-[hsl(45,10%,90%)]">
                <SelectValue placeholder="Todas as lojas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as lojas</SelectItem>
                {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-[140px] h-8 text-xs bg-[hsl(0,0%,15%)] border-[hsl(0,0%,20%)] text-[hsl(45,10%,90%)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="month">Mês atual</SelectItem>
                <SelectItem value="last_month">Mês passado</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
            {period === "custom" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1 h-8 text-xs bg-[hsl(0,0%,15%)] border-[hsl(0,0%,20%)] text-[hsl(45,10%,90%)]">
                    <Calendar className="h-3.5 w-3.5" />
                    {format(new Date(customFrom + 'T12:00:00'), 'dd/MM/yy')} — {format(new Date(customTo + 'T12:00:00'), 'dd/MM/yy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3 space-y-2" align="end">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium w-8">De:</label>
                    <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 text-xs w-[150px]" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium w-8">Até:</label>
                    <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 text-xs w-[150px]" />
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Button variant="outline" size="sm" onClick={syncTinyOrders} disabled={syncing || syncingShopify || syncingStock} className="gap-1 h-8 text-xs bg-primary text-primary-foreground border-primary hover:bg-primary/90 hover:text-primary-foreground">
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {syncing && syncProgress
                ? `${syncProgress.storeName} — ${syncProgress.currentDate}`
                : syncing ? "Iniciando..." : "Pedidos Tiny"}
            </Button>
            <Button variant="outline" size="sm" onClick={syncTinyStock} disabled={syncing || syncingShopify || syncingStock} className="gap-1 h-8 text-xs bg-[hsl(25,90%,52%)] text-white border-[hsl(25,90%,52%)] hover:bg-[hsl(25,90%,45%)] max-w-[280px]">
              {syncingStock ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Box className="h-3.5 w-3.5" />}
              <span className="truncate">
                {syncingStock && syncProgress
                  ? `${syncProgress.storeName} — ${syncProgress.currentDate}`
                  : syncingStock ? "Estoque..." : "Estoque"}
              </span>
            </Button>
            <Button variant="outline" size="sm" onClick={syncShopifyOrders} disabled={syncing || syncingShopify || syncingStock} className="gap-1 h-8 text-xs bg-[hsl(0,0%,15%)] text-[hsl(45,10%,90%)] border-[hsl(0,0%,25%)] hover:bg-[hsl(0,0%,20%)]">
              {syncingShopify ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />}
              {syncingShopify ? "Shopify..." : "Shopify"}
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1 h-8 text-[hsl(45,10%,90%)] hover:text-primary hover:bg-[hsl(0,0%,15%)]"><Home className="h-4 w-4" /></Button>
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
              <KPICard title="Vendas Lojas (Tiny)" value={fmt(tinyTotalRevenue)} icon={Store} sub={`${filteredTinyOrders.length} pedidos`} />
              <KPICard title="Vendas Shopify" value={fmt(shopifyRevenue)} icon={ShoppingCart} sub={`${shopifyPaidOrders.length} pedidos`} />
              <KPICard title="Ticket Médio" value={fmt(totalOrders > 0 ? totalRevenue / totalOrders : 0)} icon={TrendingUp} />
              <KPICard title="Itens Vendidos" value={tinyItemsSold.toString()} icon={Package} />
              <KPICard title="Descontos" value={fmt(tinyDiscount + shopifyDiscount)} icon={ArrowDownRight} variant="destructive" />
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">Visão Geral</TabsTrigger>
                <TabsTrigger value="products">Produtos</TabsTrigger>
                <TabsTrigger value="stores">Lojas</TabsTrigger>
                <TabsTrigger value="inventory">Estoque</TabsTrigger>
                <TabsTrigger value="accounts_payable" className="gap-1">
                  <Receipt className="h-3.5 w-3.5" />
                  Contas a Pagar
                </TabsTrigger>
              </TabsList>

              {/* Overview */}
              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card className="lg:col-span-2">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Faturamento Diário (Tiny ERP + Shopify)</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={dailyTrend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                          <Tooltip formatter={(v: number) => fmt(v)} />
                          <Legend />
                          <Bar dataKey="lojas" name="Lojas (Tiny)" fill="hsl(0, 0%, 15%)" radius={[4,4,0,0]} />
                          <Bar dataKey="shopify" name="Shopify" fill="hsl(48, 95%, 50%)" radius={[4,4,0,0]} />
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

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Comparativo por Canal</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={storeComparison} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => fmt(v)} />
                        <Bar dataKey="revenue" name="Faturamento" fill="hsl(25, 90%, 52%)" radius={[0,4,4,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Products */}
              <TabsContent value="products" className="space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Top Produtos (Tiny ERP)</CardTitle></CardHeader>
                  <CardContent>
                    {productRanking.length === 0 ? (
                      <p className="text-muted-foreground text-sm text-center py-8">Sincronize os dados do Tiny para ver o ranking de produtos.</p>
                    ) : (
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
                              <TableCell className="max-w-[300px] truncate text-xs">{p.name}</TableCell>
                              <TableCell className="text-right">{p.qty}</TableCell>
                              <TableCell className="text-right font-semibold">{fmt(p.revenue)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
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
                            <p className="text-xs text-muted-foreground">{sc.orders} pedidos no período</p>
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
                  <KPICard title="Valor em Estoque (Venda)" value={fmt(totalStockValue)} icon={Package} />
                  <KPICard title="Custo em Estoque" value={fmt(totalStockCost)} icon={DollarSign} />
                  <KPICard title="Margem Estimada" value={totalStockCost > 0 ? `${(((totalStockValue - totalStockCost) / totalStockValue) * 100).toFixed(0)}%` : "—"} icon={TrendingUp} />
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
                            <span className="text-muted-foreground">Valor (venda)</span>
                            <span className="font-semibold">{fmt(inv.totalValue)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Custo</span>
                            <span className="font-semibold text-muted-foreground">{fmt(inv.totalCost)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Margem</span>
                            <span className="font-semibold">{inv.totalCost > 0 ? `${(((inv.totalValue - inv.totalCost) / inv.totalValue) * 100).toFixed(0)}%` : "—"}</span>
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

              {/* Contas a Pagar */}
              <TabsContent value="accounts_payable" className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Contas a Pagar — Todas as Contas Tiny</h3>
                  <Button
                    variant="outline" size="sm"
                    onClick={syncAccountsPayable}
                    disabled={syncingAP || syncing}
                    className="gap-1 h-8 text-xs"
                  >
                    {syncingAP ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {syncingAP ? "Sincronizando..." : "Sincronizar Contas"}
                  </Button>
                </div>

                <AccountsPayableContent
                  accountsPayable={accountsPayable}
                  stores={stores}
                  storeFilter={storeFilter}
                  fmt={fmt}
                />
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

function AccountsPayableContent({ accountsPayable, stores, storeFilter, fmt }: {
  accountsPayable: any[];
  stores: StoreRow[];
  storeFilter: string;
  fmt: (v: number) => string;
}) {
  const filtered = storeFilter === "all"
    ? accountsPayable
    : accountsPayable.filter(ap => ap.store_id === storeFilter);

  const openAP = filtered.filter(ap => ap.situacao === 'aberto' || ap.situacao === 'parcial');
  const paidAP = filtered.filter(ap => ap.situacao === 'pago');
  const overdueAP = openAP.filter(ap => ap.data_vencimento && new Date(ap.data_vencimento) < new Date());
  const totalOpen = openAP.reduce((s: number, ap: any) => s + Number(ap.saldo || ap.valor || 0), 0);
  const totalPaid = paidAP.reduce((s: number, ap: any) => s + Number(ap.valor_pago || ap.valor || 0), 0);
  const totalOverdue = overdueAP.reduce((s: number, ap: any) => s + Number(ap.saldo || ap.valor || 0), 0);

  const getStoreName = (storeId: string) => stores.find(s => s.id === storeId)?.name || "—";

  const formatDateBR = (d: string | null) => {
    if (!d) return "—";
    const date = new Date(d + 'T12:00:00');
    return date.toLocaleDateString("pt-BR");
  };

  const situacaoBadge = (sit: string) => {
    switch (sit) {
      case 'pago': return <Badge className="bg-primary text-primary-foreground text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />Pago</Badge>;
      case 'aberto': return <Badge variant="outline" className="text-[10px]"><Clock className="h-3 w-3 mr-1" />Aberto</Badge>;
      case 'parcial': return <Badge className="bg-accent text-accent-foreground text-[10px]">Parcial</Badge>;
      case 'cancelado': return <Badge variant="destructive" className="text-[10px]">Cancelado</Badge>;
      default: return <Badge variant="secondary" className="text-[10px]">{sit}</Badge>;
    }
  };

  const isOverdue = (ap: any) => ap.data_vencimento && new Date(ap.data_vencimento) < new Date() && (ap.situacao === 'aberto' || ap.situacao === 'parcial');

  if (filtered.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Receipt className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhuma conta a pagar sincronizada.</p>
          <p className="text-xs mt-1">Clique em "Sincronizar Contas" para importar do Tiny ERP.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Total em Aberto" value={fmt(totalOpen)} icon={Clock} variant={totalOpen > 0 ? "destructive" : undefined} />
        <KPICard title="Vencidas" value={fmt(totalOverdue)} icon={AlertTriangle} variant="destructive" sub={`${overdueAP.length} contas`} />
        <KPICard title="Total Pago" value={fmt(totalPaid)} icon={CheckCircle2} sub={`${paidAP.length} contas`} />
        <KPICard title="Total de Contas" value={filtered.length.toString()} icon={Receipt} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Contas em Aberto e Vencidas</CardTitle>
        </CardHeader>
        <CardContent>
          {openAP.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">Nenhuma conta em aberto 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Fornecedor</TableHead>
                    <TableHead className="text-xs">Loja</TableHead>
                    <TableHead className="text-xs">Nº Doc</TableHead>
                    <TableHead className="text-xs">Vencimento</TableHead>
                    <TableHead className="text-xs text-right">Valor</TableHead>
                    <TableHead className="text-xs text-right">Saldo</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Categoria</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openAP.sort((a, b) => (a.data_vencimento || '').localeCompare(b.data_vencimento || '')).map((ap: any) => (
                    <TableRow key={ap.id} className={isOverdue(ap) ? "bg-destructive/5" : ""}>
                      <TableCell className="text-xs font-medium max-w-[200px] truncate">{ap.nome_fornecedor || "—"}</TableCell>
                      <TableCell className="text-xs">{getStoreName(ap.store_id)}</TableCell>
                      <TableCell className="text-xs">{ap.numero_doc || "—"}</TableCell>
                      <TableCell className="text-xs">
                        <span className={isOverdue(ap) ? "text-destructive font-bold" : ""}>
                          {formatDateBR(ap.data_vencimento)}
                        </span>
                        {isOverdue(ap) && <AlertTriangle className="h-3 w-3 inline ml-1 text-destructive" />}
                      </TableCell>
                      <TableCell className="text-xs text-right">{fmt(Number(ap.valor || 0))}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{fmt(Number(ap.saldo || 0))}</TableCell>
                      <TableCell>{situacaoBadge(ap.situacao)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{ap.categoria || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Contas Pagas</CardTitle>
        </CardHeader>
        <CardContent>
          {paidAP.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">Nenhuma conta paga registrada.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Fornecedor</TableHead>
                    <TableHead className="text-xs">Loja</TableHead>
                    <TableHead className="text-xs">Nº Doc</TableHead>
                    <TableHead className="text-xs">Pagamento</TableHead>
                    <TableHead className="text-xs text-right">Valor</TableHead>
                    <TableHead className="text-xs text-right">Pago</TableHead>
                    <TableHead className="text-xs">Categoria</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paidAP.slice(0, 50).map((ap: any) => (
                    <TableRow key={ap.id}>
                      <TableCell className="text-xs font-medium max-w-[200px] truncate">{ap.nome_fornecedor || "—"}</TableCell>
                      <TableCell className="text-xs">{getStoreName(ap.store_id)}</TableCell>
                      <TableCell className="text-xs">{ap.numero_doc || "—"}</TableCell>
                      <TableCell className="text-xs">{formatDateBR(ap.data_pagamento)}</TableCell>
                      <TableCell className="text-xs text-right">{fmt(Number(ap.valor || 0))}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{fmt(Number(ap.valor_pago || 0))}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{ap.categoria || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
