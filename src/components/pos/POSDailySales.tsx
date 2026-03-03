import { useState, useEffect, useMemo } from "react";
import {
  DollarSign, ShoppingCart, Tag, Users, TrendingUp,
  Package, Loader2, RefreshCw, BarChart3, Send, RotateCcw,
  CalendarIcon, ChevronLeft, ChevronRight, Search, X, Layers,
  Clock, AlertTriangle
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { POSSaleDetailDialog } from "./POSSaleDetailDialog";
import type { DateRange } from "react-day-picker";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Props {
  storeId: string;
}

interface SaleSummary {
  id: string;
  created_at: string;
  paid_at?: string | null;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: string | null;
  seller_id: string | null;
  status: string;
  tiny_order_number: string | null;
  tiny_order_id: string | null;
  customer_id: string | null;
  sale_type: string | null;
  customer_name?: string | null;
  checkout_step?: number | null;
}

interface TinyOnlyOrder {
  tiny_order_id: string;
  tiny_order_number: string;
  date: string | null;
  customer_name: string | null;
  total: number;
  status: string | null;
  items_summary: string;
}

interface SellerStats {
  name: string;
  count: number;
  total: number;
  totalItems: number;
  avgItemsPerSale: number;
  sellerId: string;
}

interface GoalInfo {
  id: string;
  goal_type: string;
  goal_value: number;
  seller_id: string | null;
  goal_category?: string | null;
  goal_brand?: string | null;
  prize_label?: string | null;
}

interface CustomerInfo {
  name: string | null;
  cpf: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  address_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
}

interface SaleItem {
  sale_id: string;
  quantity: number;
  unit_price: number;
  product_name: string;
  variant_name: string | null;
  size: string | null;
  category: string | null;
  sku?: string | null;
  barcode?: string | null;
}

type PeriodMode = "day" | "week" | "month" | "custom";

export function POSDailySales({ storeId }: Props) {
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<Map<string, CustomerInfo>>(new Map());
  const [goals, setGoals] = useState<GoalInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [periodMode, setPeriodMode] = useState<PeriodMode>("day");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  // Detail dialog
  const [selectedSale, setSelectedSale] = useState<SaleSummary | null>(null);
  const [detailItems, setDetailItems] = useState<SaleItem[]>([]);
  const [detailCustomer, setDetailCustomer] = useState<CustomerInfo | null>(null);
  const [tinyDetailLoading, setTinyDetailLoading] = useState(false);
  const [isTinyOnlyDetail, setIsTinyOnlyDetail] = useState(false);
  const [tinySellerName, setTinySellerName] = useState<string | null>(null);

  // Search
  const [searchTerm, setSearchTerm] = useState("");
  const [globalResults, setGlobalResults] = useState<SaleSummary[]>([]);
  const [globalResultItems, setGlobalResultItems] = useState<SaleItem[]>([]);
  const [globalResultCustomers, setGlobalResultCustomers] = useState<Map<string, CustomerInfo>>(new Map());
  const [tinyOnlyResults, setTinyOnlyResults] = useState<TinyOnlyOrder[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showGlobalResults, setShowGlobalResults] = useState(false);

  // Product grouping
  const [groupByParent, setGroupByParent] = useState(false);
  const [recoveringCustomers, setRecoveringCustomers] = useState(false);

  const isToday = selectedDate.toDateString() === new Date().toDateString();

  const getDateRange = (): { start: Date; end: Date } => {
    if (periodMode === "custom" && customRange?.from) {
      const start = new Date(customRange.from);
      start.setHours(0, 0, 0, 0);
      const end = customRange.to ? new Date(customRange.to) : new Date(customRange.from);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (periodMode === "week") {
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      const start = new Date(selectedDate);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    if (periodMode === "month") {
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      const start = new Date(selectedDate);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    // day
    const start = new Date(selectedDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(selectedDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange();

      const selectFields = "id, created_at, paid_at, subtotal, discount, total, payment_method, seller_id, status, tiny_order_number, tiny_order_id, customer_id, sale_type, customer_name, checkout_step";
      
      // Query 1: Sales created in date range (pending, online_pending, failed, etc.)
      // Query 2: Sales PAID in date range (paid/completed) — appear on payment date
      const [createdRes, paidRes, sellersRes, goalsRes] = await Promise.all([
        supabase
          .from("pos_sales")
          .select(selectFields)
          .eq("store_id", storeId)
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString())
          .not("status", "in", '("paid","completed","pending_sync","pending_pickup")')
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_sales")
          .select(selectFields)
          .eq("store_id", storeId)
          .in("status", ["paid", "completed", "pending_sync", "pending_pickup"])
          .or(`and(paid_at.gte.${start.toISOString()},paid_at.lte.${end.toISOString()}),and(paid_at.is.null,created_at.gte.${start.toISOString()},created_at.lte.${end.toISOString()})`)
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_sellers")
          .select("id, name")
          .eq("store_id", storeId),
        supabase
          .from("pos_goals")
          .select("id, goal_type, goal_value, seller_id, goal_category, goal_brand, prize_label")
          .eq("store_id", storeId)
          .eq("is_active", true),
      ]);

      // Merge both queries, dedup by id
      const mergedMap = new Map<string, SaleSummary>();
      for (const s of (createdRes.data || [])) mergedMap.set(s.id, s as SaleSummary);
      for (const s of (paidRes.data || [])) mergedMap.set(s.id, s as SaleSummary);
      const salesData = Array.from(mergedMap.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setSales(salesData);
      setSellers(sellersRes.data || []);
      setGoals((goalsRes.data as GoalInfo[]) || []);

      if (salesData.length > 0) {
        const saleIds = salesData.map((s) => s.id);
        const { data: items } = await supabase
          .from("pos_sale_items")
          .select("sale_id, quantity, unit_price, product_name, variant_name, size, category, sku, barcode")
          .in("sale_id", saleIds);
        setSaleItems((items as SaleItem[]) || []);

        const customerIds = [...new Set(salesData.map(s => s.customer_id).filter(Boolean))] as string[];
        if (customerIds.length > 0) {
          const { data: custData } = await supabase
            .from("pos_customers")
            .select("id, name, cpf, whatsapp, email, address, address_number, complement, neighborhood, city, state, cep")
            .in("id", customerIds);
          const map = new Map<string, CustomerInfo>();
          (custData || []).forEach((c: any) => map.set(c.id, c));
          setCustomers(map);
        } else {
          setCustomers(new Map());
        }
      } else {
        setSaleItems([]);
        setCustomers(new Map());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openSaleDetail = async (sale: SaleSummary) => {
    setSelectedSale(sale);
    setIsTinyOnlyDetail(false);
    let items = saleItems.filter(i => i.sale_id === sale.id);
    if (items.length === 0 && showGlobalResults) {
      items = globalResultItems.filter(i => i.sale_id === sale.id);
    }
    if (items.length === 0) {
      const { data } = await supabase
        .from("pos_sale_items")
        .select("sale_id, quantity, unit_price, product_name, variant_name, size, category, sku, barcode")
        .eq("sale_id", sale.id);
      items = (data as SaleItem[]) || [];
    }
    setDetailItems(items);

    let cust: CustomerInfo | null = null;
    if (sale.customer_id) {
      cust = customers.get(sale.customer_id) || globalResultCustomers.get(sale.customer_id) || null;
      if (!cust) {
        const { data } = await supabase
          .from("pos_customers")
          .select("id, name, cpf, whatsapp, email, address, address_number, complement, neighborhood, city, state, cep")
          .eq("id", sale.customer_id)
          .maybeSingle();
        cust = data as CustomerInfo | null;
      }
    }
    setDetailCustomer(cust);
  };

  const openTinyOrderDetail = async (order: TinyOnlyOrder) => {
    setTinyDetailLoading(true);
    setIsTinyOnlyDetail(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-search-orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ store_id: storeId, mode: "detail", tiny_order_id: order.tiny_order_id }),
      });
      const data = await resp.json();
      if (data.success && data.detail) {
        const d = data.detail;
        const fakeSale: SaleSummary = {
          id: `tiny-${d.tiny_order_id}`,
          created_at: d.date ? new Date(d.date.split('/').reverse().join('-')).toISOString() : new Date().toISOString(),
          subtotal: d.total + (d.discount || 0),
          discount: d.discount || 0,
          total: d.total,
          payment_method: d.payment_method,
          seller_id: null,
          status: d.status || '',
          tiny_order_number: d.tiny_order_number,
          tiny_order_id: d.tiny_order_id,
          customer_id: null,
          sale_type: null,
        };
        setSelectedSale(fakeSale);
        setDetailItems(d.items || []);
        setDetailCustomer(d.customer || null);
        // Store the Tiny seller name for display
        if (d.seller_name) {
          setTinySellerName(d.seller_name);
        } else {
          setTinySellerName(null);
        }
      } else {
        toast.error("Erro ao buscar detalhes: " + (data.error || "Erro desconhecido"));
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao buscar detalhes do pedido Tiny");
    } finally {
      setTinyDetailLoading(false);
    }
  };

  const searchAllPeriods = async () => {
    if (searchTerm.trim().length < 3) return;
    setSearchLoading(true);
    setShowGlobalResults(true);
    try {
      const term = `%${searchTerm.trim()}%`;
      const [localResult, tinyResult] = await Promise.all([
        (async () => {
          // Use textSearch to normalize accents client-side
          const normalizedTerm = searchTerm.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const termPattern = `%${normalizedTerm}%`;
          const { data: matchingCustomers } = await supabase
            .from("pos_customers")
            .select("id, name, cpf, whatsapp, email, address, address_number, complement, neighborhood, city, state, cep")
            .or(`name.ilike.${term},cpf.ilike.${term},whatsapp.ilike.${term}`)
            .limit(50);
          
          // Also search with normalized term for accent-insensitive matches
          let allCustomers = matchingCustomers || [];
          if (normalizedTerm !== searchTerm.trim()) {
            const { data: extraCustomers } = await supabase
              .from("pos_customers")
              .select("id, name, cpf, whatsapp, email, address, address_number, complement, neighborhood, city, state, cep")
              .or(`name.ilike.${termPattern},cpf.ilike.${termPattern},whatsapp.ilike.${termPattern}`)
              .limit(50);
            const existingIds = new Set(allCustomers.map((c: any) => c.id));
            for (const c of (extraCustomers || [])) {
              if (!existingIds.has(c.id)) allCustomers.push(c);
            }
          }
          if (!allCustomers || allCustomers.length === 0) {
            return { sales: [], items: [], customers: new Map<string, CustomerInfo>() };
          }
          const custMap = new Map<string, CustomerInfo>();
          allCustomers.forEach((c: any) => custMap.set(c.id, c));
          const custIds = allCustomers.map((c: any) => c.id);
          const { data: salesData } = await supabase
            .from("pos_sales")
            .select("id, created_at, subtotal, discount, total, payment_method, seller_id, status, tiny_order_number, tiny_order_id, customer_id, sale_type, store_id")
            .in("customer_id", custIds)
            .order("created_at", { ascending: false })
            .limit(50);
          let items: SaleItem[] = [];
          if (salesData && salesData.length > 0) {
            const saleIds = salesData.map(s => s.id);
            const { data: itemsData } = await supabase
              .from("pos_sale_items")
              .select("sale_id, quantity, unit_price, product_name, variant_name, size, category, sku, barcode")
              .in("sale_id", saleIds);
            items = (itemsData as SaleItem[]) || [];
          }
          return { sales: salesData || [], items, customers: custMap };
        })(),
        (async () => {
          try {
            const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-search-orders`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
              },
              body: JSON.stringify({ store_id: storeId, search_term: searchTerm.trim() }),
            });
            const data = await resp.json();
            return data.success ? (data.orders as TinyOnlyOrder[]) : [];
          } catch {
            return [];
          }
        })(),
      ]);
      setGlobalResults(localResult.sales);
      setGlobalResultItems(localResult.items);
      setGlobalResultCustomers(localResult.customers);
      const localTinyIds = new Set(localResult.sales.map((s: SaleSummary) => s.tiny_order_id).filter(Boolean));
      const uniqueTinyOrders = (tinyResult || []).filter(
        (t: TinyOnlyOrder) => !localTinyIds.has(t.tiny_order_id)
      );
      setTinyOnlyResults(uniqueTinyOrders);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao buscar pedidos");
    } finally {
      setSearchLoading(false);
    }
  };

  const resendToTiny = async (sale: SaleSummary) => {
    setResending(sale.id);
    try {
      const { data: items } = await supabase
        .from("pos_sale_items")
        .select("*")
        .eq("sale_id", sale.id);
      if (!items || items.length === 0) {
        toast.error("Nenhum item encontrado para esta venda");
        return;
      }
      let customer: any = undefined;
      if (sale.customer_id) {
        const { data: cust } = await supabase
          .from("pos_customers")
          .select("*")
          .eq("id", sale.customer_id)
          .maybeSingle();
        if (cust) {
          customer = {
            id: cust.id, name: cust.name, cpf: cust.cpf,
            email: cust.email, whatsapp: cust.whatsapp,
            address: cust.address, cep: cust.cep, city: cust.city, state: cust.state,
          };
        }
      }
      let tinySellerId: string | undefined;
      if (sale.seller_id) {
        const { data: sellerData } = await supabase
          .from("pos_sellers")
          .select("tiny_seller_id")
          .eq("id", sale.seller_id)
          .maybeSingle();
        tinySellerId = sellerData?.tiny_seller_id || undefined;
      }
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/pos-tiny-create-sale`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          store_id: storeId,
          seller_id: sale.seller_id || undefined,
          tiny_seller_id: tinySellerId,
          customer,
          items: items.map((item: any) => ({
            tiny_id: item.tiny_product_id, sku: item.sku,
            name: item.product_name, variant: item.variant_name,
            size: item.size, category: item.category,
            price: item.unit_price, quantity: item.quantity, barcode: item.barcode,
          })),
          payment_method_name: sale.payment_method || undefined,
          discount: sale.discount > 0 ? sale.discount : undefined,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success(`Venda reenviada ao Tiny! Pedido #${data.tiny_order_number || data.tiny_order_id}`);
        await supabase
          .from("pos_sales")
          .update({
            tiny_order_id: String(data.tiny_order_id),
            tiny_order_number: data.tiny_order_number ? String(data.tiny_order_number) : null,
          })
          .eq("id", sale.id);
        loadData();
      } else {
        toast.error(data.error || "Erro ao reenviar ao Tiny");
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao reenviar venda");
    } finally {
      setResending(null);
    }
  };

  const recoverMissingCustomers = async () => {
    setRecoveringCustomers(true);
    try {
      // Find online sales without customer_id
      const onlineSalesNoCustomer = sales.filter(s => s.sale_type === 'online' && !s.customer_id && s.status === 'completed');
      if (onlineSalesNoCustomer.length === 0) {
        toast.info("Nenhuma venda online sem cliente encontrada");
        setRecoveringCustomers(false);
        return;
      }

      let recovered = 0;
      for (const sale of onlineSalesNoCustomer) {
        const { data: attempt } = await supabase
          .from("pos_checkout_attempts")
          .select("customer_name, customer_phone, customer_email")
          .eq("sale_id", sale.id)
          .eq("status", "success")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!attempt?.customer_name) continue;

        const phoneDigits = (attempt.customer_phone || "").replace(/\D/g, "");
        let customerId: string | null = null;

        if (phoneDigits) {
          const { data: existing } = await supabase
            .from("pos_customers")
            .select("id")
            .eq("whatsapp", phoneDigits)
            .maybeSingle();
          if (existing) customerId = existing.id;
        }

        const payload = {
          name: attempt.customer_name,
          whatsapp: phoneDigits,
          email: attempt.customer_email || null,
        };

        if (customerId) {
          await supabase.from("pos_customers").update(payload as any).eq("id", customerId);
        } else {
          const { data: newCust } = await supabase
            .from("pos_customers")
            .insert(payload as any)
            .select("id")
            .single();
          customerId = newCust?.id || null;
        }

        if (customerId) {
          await supabase.from("pos_sales").update({ customer_id: customerId } as any).eq("id", sale.id);
          recovered++;
        }
      }

      toast.success(`${recovered} de ${onlineSalesNoCustomer.length} clientes recuperados!`);
      loadData();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao recuperar clientes");
    } finally {
      setRecoveringCustomers(false);
    }
  };

  useEffect(() => {
    if (periodMode === "custom" && !customRange?.from) return;
    loadData();
    setShowGlobalResults(false);
    setGlobalResults([]);
    setTinyOnlyResults([]);
    setSearchTerm("");
  }, [storeId, selectedDate, periodMode, customRange]);

  const goToPrev = () => {
    const d = new Date(selectedDate);
    if (periodMode === "week") d.setDate(d.getDate() - 7);
    else if (periodMode === "month") d.setMonth(d.getMonth() - 1);
    else d.setDate(d.getDate() - 1);
    setSelectedDate(d);
  };
  const goToNext = () => {
    const d = new Date(selectedDate);
    if (periodMode === "week") d.setDate(d.getDate() + 7);
    else if (periodMode === "month") d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + 1);
    if (d <= new Date()) setSelectedDate(d);
  };
  const goToToday = () => setSelectedDate(new Date());

  const dateLabel = (): string => {
    if (periodMode === "custom" && customRange?.from) {
      return `${format(customRange.from, "dd/MM")}${customRange.to ? ` - ${format(customRange.to, "dd/MM")}` : ""}`;
    }
    if (periodMode === "week") {
      const { start, end } = getDateRange();
      return `${format(start, "dd/MM")} - ${format(end, "dd/MM")}`;
    }
    if (periodMode === "month") {
      const { start, end } = getDateRange();
      return `${format(start, "dd/MM")} - ${format(end, "dd/MM")}`;
    }
    return isToday ? "Hoje" : format(selectedDate, "dd/MM/yyyy");
  };

  // Calculations
  // Status filter for tabs
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'awaiting_payment' | 'not_approved'>('all');

  const completedSales = sales.filter((s) => s.status === "completed" || s.status === "pending_sync" || s.status === "pending_pickup" || s.status === "paid");
  const awaitingPaymentSales = sales.filter((s) => s.status === "online_pending");
  const notApprovedSales = sales.filter((s) => ["payment_failed", "payment_declined", "cancelled"].includes(s.status));

  // KPI data source based on active filter
  const kpiSales = statusFilter === 'awaiting_payment'
    ? awaitingPaymentSales
    : statusFilter === 'not_approved'
      ? notApprovedSales
      : statusFilter === 'completed'
        ? completedSales
        : sales; // 'all'

  const kpiSaleIds = new Set(kpiSales.map(s => s.id));
  const kpiItems = saleItems.filter(i => kpiSaleIds.has(i.sale_id));

  const totalRevenue = kpiSales.reduce((s, sale) => s + (sale.total || 0), 0);
  const totalDiscount = kpiSales.reduce((s, sale) => s + (sale.discount || 0), 0);
  const avgTicket = kpiSales.length > 0 ? totalRevenue / kpiSales.length : 0;
  const totalItemsSold = kpiItems.reduce((s, item) => s + (item.quantity || 0), 0);
  const avgPricePerItem = totalItemsSold > 0 ? totalRevenue / totalItemsSold : 0;

  // Sales by seller (with items per sale)
  const sellerStatsMap = new Map<string, SellerStats>();
  for (const sale of completedSales) {
    const sellerId = sale.seller_id || "sem-vendedor";
    const sellerName = sellers.find((s) => s.id === sellerId)?.name || "Sem vendedor";
    const existing = sellerStatsMap.get(sellerId) || { name: sellerName, count: 0, total: 0, totalItems: 0, avgItemsPerSale: 0, sellerId };
    existing.count += 1;
    existing.total += sale.total || 0;
    // Count items for this sale
    const itemsForSale = saleItems.filter(i => i.sale_id === sale.id).reduce((s, i) => s + (i.quantity || 0), 0);
    existing.totalItems += itemsForSale;
    sellerStatsMap.set(sellerId, existing);
  }
  // Calculate avg items per sale
  for (const [, stats] of sellerStatsMap) {
    stats.avgItemsPerSale = stats.count > 0 ? stats.totalItems / stats.count : 0;
  }
  const sellerStats = Array.from(sellerStatsMap.values()).sort((a, b) => b.total - a.total);

  // Goals check per seller
  const getSellerGoals = (sellerId: string) => {
    const storeGoals = goals.filter(g => !g.seller_id && (g.goal_type === 'revenue' || g.goal_type === 'avg_ticket' || g.goal_type === 'items_sold'));
    const individualGoals = goals.filter(g => g.seller_id === sellerId);
    const sellerStat = sellerStatsMap.get(sellerId);
    const sellerRevenue = sellerStat?.total || 0;
    const sellerAvgTicket = sellerStat && sellerStat.count > 0 ? sellerStat.total / sellerStat.count : 0;
    const sellerAvgItems = sellerStat?.avgItemsPerSale || 0;

    const results: { label: string; current: number; target: number; achieved: boolean; prize?: string | null }[] = [];

    for (const g of storeGoals) {
      let current = 0;
      if (g.goal_type === 'revenue') current = totalRevenue;
      else if (g.goal_type === 'avg_ticket') current = avgTicket;
      else if (g.goal_type === 'items_sold') current = totalItemsSold > 0 && completedSales.length > 0 ? totalItemsSold / completedSales.length : 0;
      results.push({ label: `Loja: ${g.goal_type === 'revenue' ? 'Faturamento' : g.goal_type === 'avg_ticket' ? 'Ticket Médio' : 'Itens/Venda'}`, current, target: g.goal_value, achieved: current >= g.goal_value, prize: g.prize_label });
    }

    for (const g of individualGoals) {
      let current = 0;
      if (g.goal_type === 'seller_revenue') current = sellerRevenue;
      else if (g.goal_type === 'revenue') current = sellerRevenue;
      results.push({ label: g.prize_label ? `Individual: ${g.prize_label}` : 'Meta Individual', current, target: g.goal_value, achieved: current >= g.goal_value, prize: g.prize_label });
    }

    return results;
  };

  // Sales by payment method
  const paymentStats = new Map<string, { count: number; total: number }>();
  for (const sale of completedSales) {
    const method = sale.payment_method || "Não informado";
    const existing = paymentStats.get(method) || { count: 0, total: 0 };
    existing.count += 1;
    existing.total += sale.total || 0;
    paymentStats.set(method, existing);
  }

  // Top products (with grouping toggle)
  const topProducts = useMemo(() => {
    const productMap = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const item of saleItems) {
      let key: string;
      let name: string;
      if (groupByParent) {
        const dashIndex = item.product_name.indexOf(" - ");
        name = dashIndex > -1 ? item.product_name.substring(0, dashIndex).trim() : item.product_name;
        key = name;
      } else {
        name = item.product_name + (item.variant_name ? ` - ${item.variant_name}` : "");
        key = name;
      }
      const existing = productMap.get(key) || { name, qty: 0, revenue: 0 };
      existing.qty += item.quantity || 0;
      existing.revenue += (item.quantity || 0) * (item.unit_price || 0);
      productMap.set(key, existing);
    }
    return Array.from(productMap.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);
  }, [saleItems, groupByParent]);

  const getItemsSummary = (saleId: string, itemsSource: SaleItem[] = saleItems) => {
    const items = itemsSource.filter(i => i.sale_id === saleId);
    if (items.length === 0) return "";
    const names = items.slice(0, 2).map(i => {
      const base = i.product_name.indexOf(" - ") > -1
        ? i.product_name.substring(i.product_name.indexOf(" ") + 1, i.product_name.indexOf(" - ")).trim()
        : i.product_name;
      const short = base.length > 20 ? base.substring(0, 20) + "…" : base;
      return `${short}${i.size ? ` ${i.size}` : ""}`;
    });
    if (items.length > 2) names.push(`+${items.length - 2}`);
    return names.join(", ");
  };

  // Local search filter
  // Determine which sales to show based on status filter
  const salesForStatusFilter = statusFilter === 'awaiting_payment'
    ? awaitingPaymentSales
    : statusFilter === 'not_approved'
      ? notApprovedSales
      : statusFilter === 'completed'
        ? completedSales
        : sales; // 'all' shows everything

  const filteredSales = searchTerm.trim().length > 0
    ? salesForStatusFilter.filter(sale => {
        if (!sale.customer_id) return false;
        const cust = customers.get(sale.customer_id);
        if (!cust) return false;
        const term = searchTerm.toLowerCase();
        return (cust.name?.toLowerCase().includes(term)) ||
               (cust.cpf?.includes(term)) ||
               (cust.whatsapp?.includes(term));
      })
    : salesForStatusFilter;

  const displaySales = showGlobalResults ? globalResults : filteredSales;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-pos-white/50">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando vendas...
      </div>
    );
  }

  const renderSaleCard = (sale: SaleSummary, itemsSource: SaleItem[] = saleItems, customerSource: Map<string, CustomerInfo> = customers) => {
    const sellerName = sellers.find((s) => s.id === sale.seller_id)?.name;
    const time = new Date(sale.created_at);
    const custName = sale.customer_name || (sale.customer_id ? customerSource.get(sale.customer_id)?.name : null);
    const checkoutStep = sale.checkout_step;
    const summary = getItemsSummary(sale.id, itemsSource);
    const showFullDate = showGlobalResults || periodMode !== "day";

    return (
      <div
        key={sale.id}
        className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10 cursor-pointer hover:bg-pos-white/10 transition-colors"
        onClick={() => openSaleDetail(sale)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-xs text-pos-white/40 font-mono shrink-0">
            {showFullDate ? format(time, "dd/MM HH:mm") : format(time, "HH:mm")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {sale.sale_type === 'online' ? (
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0">
                  Online
                </Badge>
              ) : (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0">
                  Loja
                </Badge>
              )}
              {sale.status === 'online_pending' && (
                <>
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px] px-1.5 py-0 animate-pulse">
                    <Clock className="h-2.5 w-2.5 mr-0.5" />Aguardando Pgto
                  </Badge>
                  {checkoutStep != null && checkoutStep > 0 ? (
                    <Badge className={`text-[10px] px-1.5 py-0 ${
                      checkoutStep === 1 ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                      checkoutStep === 2 ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' :
                      'bg-purple-500/20 text-purple-400 border-purple-500/30'
                    }`}>
                      Etapa {checkoutStep}/3
                    </Badge>
                  ) : (
                    <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-[10px] px-1.5 py-0">
                      Abriu link
                    </Badge>
                  )}
                </>
              )}
              {(sale.status === 'payment_failed' || sale.status === 'payment_declined' || sale.status === 'cancelled') && (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">
                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Não Aprovado
                </Badge>
              )}
              {sale.tiny_order_number ? (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0">
                  Tiny #{sale.tiny_order_number}
                </Badge>
              ) : sale.status === 'pending_sync' ? (
                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px] px-1.5 py-0">
                  Pendente Tiny
                </Badge>
              ) : sale.status !== 'online_pending' && sale.status !== 'payment_failed' && sale.status !== 'payment_declined' && sale.status !== 'cancelled' ? (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">
                  Erro Tiny
                </Badge>
              ) : null}
              {custName && (
                <p className="text-xs text-pos-white font-medium truncate">{custName}</p>
              )}
            </div>
            {summary && (
              <p className="text-[10px] text-pos-white/40 truncate">{summary}</p>
            )}
            <p className="text-[10px] text-pos-white/40">
              {sale.payment_method || "—"}
              {sellerName && ` • ${sellerName}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="font-bold text-sm text-pos-white">R$ {(sale.total || 0).toFixed(2)}</p>
            {sale.discount > 0 && (
              <p className="text-[10px] text-red-400">-R$ {sale.discount.toFixed(2)}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 text-xs"
            onClick={(e) => { e.stopPropagation(); resendToTiny(sale); }}
            disabled={resending === sale.id}
          >
            {resending === sale.id ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            <span className="hidden sm:inline">{sale.tiny_order_id ? "Reenviar" : "Enviar"}</span>
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-pos-orange/20 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-pos-orange" />
          <h2 className="text-lg font-bold text-pos-white">Pedidos de Vendas</h2>
          <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/30">
            {completedSales.length} vendas
          </Badge>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <ToggleGroup
            type="single"
            value={periodMode}
            onValueChange={(v) => {
              if (!v) return;
              if (v !== "custom") setCustomRange(undefined);
              setPeriodMode(v as PeriodMode);
            }}
            className="bg-pos-white/5 rounded-lg p-0.5"
          >
            <ToggleGroupItem value="day" className="text-xs px-2.5 py-1 data-[state=on]:bg-pos-orange data-[state=on]:text-pos-black text-pos-white/60 rounded-md">
              Dia
            </ToggleGroupItem>
            <ToggleGroupItem value="week" className="text-xs px-2.5 py-1 data-[state=on]:bg-pos-orange data-[state=on]:text-pos-black text-pos-white/60 rounded-md">
              Semana
            </ToggleGroupItem>
            <ToggleGroupItem value="month" className="text-xs px-2.5 py-1 data-[state=on]:bg-pos-orange data-[state=on]:text-pos-black text-pos-white/60 rounded-md">
              Mês
            </ToggleGroupItem>
            <ToggleGroupItem value="custom" className="text-xs px-2.5 py-1 data-[state=on]:bg-pos-orange data-[state=on]:text-pos-black text-pos-white/60 rounded-md">
              <CalendarIcon className="h-3 w-3 mr-1" />
              Período
            </ToggleGroupItem>
          </ToggleGroup>

          {periodMode !== "custom" && (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-pos-white/60 hover:text-pos-white" onClick={goToPrev}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 text-xs min-w-[120px]">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {dateLabel()}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => d && setSelectedDate(d)}
                    disabled={(date) => date > new Date()}
                    locale={ptBR}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-pos-white/60 hover:text-pos-white" onClick={goToNext} disabled={isToday}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!isToday && (
                <Button variant="outline" size="sm" className="text-xs border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10" onClick={goToToday}>
                  Hoje
                </Button>
              )}
            </>
          )}

          {periodMode === "custom" && (
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

          {sales.some(s => s.sale_type === 'online' && !s.customer_id && s.status === 'completed') && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 border-orange-400/30 text-orange-400 hover:bg-orange-500/10 text-xs"
              onClick={recoverMissingCustomers}
              disabled={recoveringCustomers}
            >
              {recoveringCustomers ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Recuperar Clientes</span>
            </Button>
          )}

          {/* Status Filter Tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {([
              { key: 'all' as const, label: 'Todas', count: sales.length, color: 'bg-pos-white/10 text-pos-white border-pos-white/30' },
              { key: 'completed' as const, label: 'Concluídas', count: completedSales.length, color: 'bg-green-500/15 text-green-500 border-green-500/30' },
              { key: 'awaiting_payment' as const, label: 'Aguardando Pgto', count: awaitingPaymentSales.length, color: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' },
              { key: 'not_approved' as const, label: 'Não Aprovadas', count: notApprovedSales.length, color: 'bg-red-500/15 text-red-500 border-red-500/30' },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border flex items-center gap-1.5',
                  statusFilter === tab.key
                    ? tab.key === 'awaiting_payment' ? 'bg-yellow-500 text-black border-yellow-500'
                    : tab.key === 'not_approved' ? 'bg-red-500 text-white border-red-500'
                    : tab.key === 'completed' ? 'bg-green-500 text-black border-green-500'
                    : 'bg-pos-orange text-pos-black border-pos-orange'
                    : tab.color
                )}
              >
                {tab.key === 'awaiting_payment' && <Clock className="h-3 w-3" />}
                {tab.key === 'not_approved' && <AlertTriangle className="h-3 w-3" />}
                {tab.label}
                <span className={cn(
                  'ml-0.5 text-[10px] font-bold',
                  tab.key === 'awaiting_payment' && tab.count > 0 && statusFilter !== tab.key && 'animate-pulse'
                )}>
                  ({tab.count})
                </span>
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-1 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10" onClick={loadData}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KPICard icon={DollarSign} label="Faturamento" value={`R$ ${totalRevenue.toFixed(2)}`} color="text-green-500" />
            <KPICard icon={ShoppingCart} label="Vendas" value={String(kpiSales.length)} color="text-orange-500" />
            <KPICard icon={TrendingUp} label="Ticket Médio" value={`R$ ${avgTicket.toFixed(2)}`} color="text-blue-500" />
            <KPICard icon={Package} label="Itens Vendidos" value={String(totalItemsSold)} color="text-purple-500" />
            <KPICard icon={Tag} label="Preço Médio/Item" value={`R$ ${avgPricePerItem.toFixed(2)}`} color="text-yellow-500" />
          </div>

          {totalDiscount > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <Tag className="h-4 w-4 text-red-400" />
              <span className="text-sm text-red-300">Total de descontos: <strong>R$ {totalDiscount.toFixed(2)}</strong></span>
            </div>
          )}

          {/* Seller Stats */}
          {sellerStats.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
                <Users className="h-4 w-4 text-pos-orange" /> Vendas por Vendedor
              </h3>
              <div className="space-y-2">
                {sellerStats.map((s, i) => {
                  const sellerGoals = s.sellerId !== "sem-vendedor" ? getSellerGoals(s.sellerId) : [];
                  return (
                    <div key={i} className="p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-pos-orange/20 flex items-center justify-center text-xs font-bold text-pos-orange">
                            {i + 1}º
                          </div>
                          <div>
                            <p className="font-medium text-sm text-pos-white">{s.name}</p>
                            <p className="text-xs text-pos-white/50">{s.count} venda{s.count > 1 ? "s" : ""} · {s.totalItems} itens</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-sm text-pos-orange">R$ {s.total.toFixed(2)}</p>
                          <p className="text-[10px] text-pos-white/50">ticket: R$ {(s.total / s.count).toFixed(2)}</p>
                        </div>
                      </div>
                      {/* Extra metrics */}
                      <div className="flex items-center gap-3 text-[10px] text-pos-white/60 pl-11">
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3" /> Média {s.avgItemsPerSale.toFixed(1)} itens/venda
                        </span>
                        <span className="flex items-center gap-1">
                          <Tag className="h-3 w-3" /> Preço médio: R$ {(s.totalItems > 0 ? s.total / s.totalItems : 0).toFixed(2)}
                        </span>
                      </div>
                      {/* Goals */}
                      {sellerGoals.length > 0 && (
                        <div className="pl-11 space-y-1">
                          {sellerGoals.map((g, gi) => {
                            const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
                            return (
                              <div key={gi} className="flex items-center gap-2 text-[10px]">
                                {g.achieved ? (
                                  <span className="text-green-500 font-bold">✅ {g.label}</span>
                                ) : (
                                  <span className="text-yellow-500 font-medium">⏳ {g.label}: {pct.toFixed(0)}%</span>
                                )}
                                <span className="text-pos-white/40">
                                  ({g.label.includes('Itens') ? g.current.toFixed(1) : `R$ ${g.current.toFixed(0)}`} / {g.label.includes('Itens') ? g.target.toFixed(1) : `R$ ${g.target.toFixed(0)}`})
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Payment Method Stats */}
          {paymentStats.size > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-pos-orange" /> Vendas por Forma de Pagamento
              </h3>
              <div className="space-y-2">
                {Array.from(paymentStats.entries()).map(([method, stats]) => (
                  <div key={method} className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10">
                    <div>
                      <p className="font-medium text-sm text-pos-white">{method}</p>
                      <p className="text-xs text-pos-white/40">{stats.count} venda{stats.count > 1 ? "s" : ""}</p>
                    </div>
                    <p className="font-bold text-sm text-pos-orange">R$ {stats.total.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Products */}
          {topProducts.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
                  <Package className="h-4 w-4 text-pos-orange" /> Produtos Mais Vendidos
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-pos-white/40">Por produto</span>
                  <Switch
                    checked={groupByParent}
                    onCheckedChange={setGroupByParent}
                    className="data-[state=checked]:bg-pos-orange h-4 w-7"
                  />
                  <Layers className="h-3.5 w-3.5 text-pos-white/40" />
                </div>
              </div>
              <div className="space-y-2">
                {topProducts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-pos-white truncate">{p.name}</p>
                    </div>
                    <div className="flex items-center gap-4 ml-3">
                      <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/30 text-xs">{p.qty} un</Badge>
                      <span className="font-bold text-sm text-pos-orange min-w-[80px] text-right">R$ {p.revenue.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sales List */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-pos-white">Histórico de Vendas</h3>

            {/* Search bar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-pos-white/30" />
                <Input
                  placeholder="Buscar por nome, CPF ou telefone..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    if (e.target.value.trim().length === 0) {
                      setShowGlobalResults(false);
                      setGlobalResults([]);
                    }
                  }}
                  className="pl-9 bg-pos-white/5 border-pos-orange/20 text-pos-white placeholder:text-pos-white/30 text-sm h-9"
                />
                {searchTerm && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-pos-white/30 hover:text-pos-white"
                    onClick={() => { setSearchTerm(""); setShowGlobalResults(false); setGlobalResults([]); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {searchTerm.trim().length >= 3 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 text-xs whitespace-nowrap"
                  onClick={searchAllPeriods}
                  disabled={searchLoading}
                >
                  {searchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  Todos os períodos
                </Button>
              )}
            </div>

            {showGlobalResults && (
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                  POS: {globalResults.length} resultado{globalResults.length !== 1 ? "s" : ""}
                </Badge>
                {tinyOnlyResults.length > 0 && (
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
                    Tiny: {tinyOnlyResults.length} pedido{tinyOnlyResults.length !== 1 ? "s" : ""}
                  </Badge>
                )}
                <button
                  className="text-xs text-pos-white/40 hover:text-pos-white underline"
                  onClick={() => { setShowGlobalResults(false); setGlobalResults([]); setTinyOnlyResults([]); }}
                >
                  Voltar
                </button>
              </div>
            )}

            {displaySales.length === 0 && tinyOnlyResults.length === 0 ? (
              <div className="text-center py-12 text-pos-white/40">
                <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>{showGlobalResults ? "Nenhum resultado encontrado" : "Nenhuma venda registrada"}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {displaySales.map((sale) =>
                  renderSaleCard(
                    sale,
                    showGlobalResults ? globalResultItems : saleItems,
                    showGlobalResults ? globalResultCustomers : customers
                  )
                )}

                {/* Tiny-only results */}
                {showGlobalResults && tinyOnlyResults.length > 0 && (
                  <>
                    {globalResults.length > 0 && (
                      <div className="flex items-center gap-2 pt-2">
                        <div className="flex-1 h-px bg-purple-500/20" />
                        <span className="text-[10px] text-purple-400 uppercase tracking-wider">Pedidos do Tiny</span>
                        <div className="flex-1 h-px bg-purple-500/20" />
                      </div>
                    )}
                    {tinyOnlyResults.map((order) => (
                      <div
                        key={order.tiny_order_id}
                        className="flex items-center justify-between p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 cursor-pointer hover:bg-purple-500/20 transition-colors"
                        onClick={() => openTinyOrderDetail(order)}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <span className="text-xs text-pos-white/40 font-mono shrink-0">
                            {order.date || "—"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px] px-1.5 py-0">
                                Tiny #{order.tiny_order_number}
                              </Badge>
                              {order.customer_name && (
                                <p className="text-xs text-pos-white font-medium truncate">{order.customer_name}</p>
                              )}
                            </div>
                            <p className="text-[10px] text-pos-white/40 truncate">
                              {order.status || "—"} • Clique para detalhes
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-sm text-pos-white">R$ {order.total.toFixed(2)}</p>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Tiny detail loading overlay */}
      {tinyDetailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-pos-black p-6 rounded-xl flex items-center gap-3 border border-pos-orange/30">
            <Loader2 className="h-5 w-5 animate-spin text-pos-orange" />
            <span className="text-pos-white">Buscando detalhes no Tiny...</span>
          </div>
        </div>
      )}

      {/* Sale Detail Dialog */}
      <POSSaleDetailDialog
        sale={selectedSale}
        onClose={() => setSelectedSale(null)}
        customer={detailCustomer}
        items={detailItems}
        sellerName={isTinyOnlyDetail && tinySellerName ? tinySellerName : (selectedSale ? sellers.find(s => s.id === selectedSale.seller_id)?.name || null : null)}
        sellers={sellers}
        onResend={!isTinyOnlyDetail ? resendToTiny : undefined}
        resending={resending === selectedSale?.id}
        isTinyOnly={isTinyOnlyDetail}
        storeId={storeId}
        onDeleted={() => { setSelectedSale(null); loadData(); }}
      />
    </div>
  );
}

function KPICard({ icon: Icon, label, value, color }: { icon: typeof DollarSign; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-pos-orange/10 bg-pos-white/5 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] uppercase tracking-wider text-pos-white/70 font-semibold">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
