import { useState, useEffect } from "react";
import {
  DollarSign, ShoppingCart, Tag, Users, TrendingUp,
  Package, Loader2, RefreshCw, BarChart3, Send, RotateCcw,
  CalendarIcon, ChevronLeft, ChevronRight
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface Props {
  storeId: string;
}

interface SaleSummary {
  id: string;
  created_at: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: string | null;
  seller_id: string | null;
  status: string;
  tiny_order_number: string | null;
  tiny_order_id: string | null;
  customer_id: string | null;
}

interface SellerStats {
  name: string;
  count: number;
  total: number;
}

export function POSDailySales({ storeId }: Props) {
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [saleItems, setSaleItems] = useState<any[]>([]);
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const isToday = selectedDate.toDateString() === new Date().toDateString();

  const loadData = async () => {
    setLoading(true);
    try {
      const dayStart = new Date(selectedDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(selectedDate);
      dayEnd.setHours(23, 59, 59, 999);

      const [salesRes, itemsRes, sellersRes] = await Promise.all([
        supabase
          .from("pos_sales")
          .select("id, created_at, subtotal, discount, total, payment_method, seller_id, status, tiny_order_number, tiny_order_id, customer_id")
          .eq("store_id", storeId)
          .gte("created_at", dayStart.toISOString())
          .lte("created_at", dayEnd.toISOString())
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_sale_items")
          .select("sale_id, quantity, unit_price, product_name, variant_name, size, category")
          .in(
            "sale_id",
            // we'll filter after
            []
          ),
        supabase
          .from("pos_sellers")
          .select("id, name")
          .eq("store_id", storeId),
      ]);

      const salesData = salesRes.data || [];
      setSales(salesData);
      setSellers(sellersRes.data || []);

      // Now fetch items for today's sales
      if (salesData.length > 0) {
        const saleIds = salesData.map((s) => s.id);
        const { data: items } = await supabase
          .from("pos_sale_items")
          .select("sale_id, quantity, unit_price, product_name, variant_name, size, category")
          .in("sale_id", saleIds);
        setSaleItems(items || []);
      } else {
        setSaleItems([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const resendToTiny = async (sale: SaleSummary) => {
    setResending(sale.id);
    try {
      // Fetch sale items
      const { data: items } = await supabase
        .from("pos_sale_items")
        .select("*")
        .eq("sale_id", sale.id);

      if (!items || items.length === 0) {
        toast.error("Nenhum item encontrado para esta venda");
        return;
      }

      // Fetch customer if exists
      let customer: any = undefined;
      if (sale.customer_id) {
        const { data: cust } = await supabase
          .from("pos_customers")
          .select("*")
          .eq("id", sale.customer_id)
          .maybeSingle();
        if (cust) {
          customer = {
            id: cust.id,
            name: cust.name,
            cpf: cust.cpf,
            email: cust.email,
            whatsapp: cust.whatsapp,
            address: cust.address,
            cep: cust.cep,
            city: cust.city,
            state: cust.state,
          };
        }
      }

      // Look up tiny_seller_id for the seller
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
            tiny_id: item.tiny_product_id,
            sku: item.sku,
            name: item.product_name,
            variant: item.variant_name,
            size: item.size,
            category: item.category,
            price: item.unit_price,
            quantity: item.quantity,
            barcode: item.barcode,
          })),
          payment_method_name: sale.payment_method || undefined,
          discount: sale.discount > 0 ? sale.discount : undefined,
        }),
      });

      const data = await resp.json();
      if (data.success) {
        toast.success(`Venda reenviada ao Tiny! Pedido #${data.tiny_order_number || data.tiny_order_id}`);
        // Update sale record with new tiny IDs
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

  useEffect(() => {
    loadData();
  }, [storeId, selectedDate]);

  const goToPrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d);
  };
  const goToNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    if (d <= new Date()) setSelectedDate(d);
  };
  const goToToday = () => setSelectedDate(new Date());

  // Calculations
  const completedSales = sales.filter((s) => s.status === "completed");
  const totalRevenue = completedSales.reduce((s, sale) => s + (sale.total || 0), 0);
  const totalDiscount = completedSales.reduce((s, sale) => s + (sale.discount || 0), 0);
  const avgTicket = completedSales.length > 0 ? totalRevenue / completedSales.length : 0;
  const totalItemsSold = saleItems.reduce((s, item) => s + (item.quantity || 0), 0);
  const avgPricePerItem = totalItemsSold > 0 ? totalRevenue / totalItemsSold : 0;

  // Sales by seller
  const sellerStatsMap = new Map<string, SellerStats>();
  for (const sale of completedSales) {
    const sellerId = sale.seller_id || "sem-vendedor";
    const sellerName = sellers.find((s) => s.id === sellerId)?.name || "Sem vendedor";
    const existing = sellerStatsMap.get(sellerId) || { name: sellerName, count: 0, total: 0 };
    existing.count += 1;
    existing.total += sale.total || 0;
    sellerStatsMap.set(sellerId, existing);
  }
  const sellerStats = Array.from(sellerStatsMap.values()).sort((a, b) => b.total - a.total);

  // Sales by payment method
  const paymentStats = new Map<string, { count: number; total: number }>();
  for (const sale of completedSales) {
    const method = sale.payment_method || "Não informado";
    const existing = paymentStats.get(method) || { count: 0, total: 0 };
    existing.count += 1;
    existing.total += sale.total || 0;
    paymentStats.set(method, existing);
  }

  // Top products
  const productMap = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const item of saleItems) {
    const key = item.product_name + (item.variant_name ? ` - ${item.variant_name}` : "");
    const existing = productMap.get(key) || { name: key, qty: 0, revenue: 0 };
    existing.qty += item.quantity || 0;
    existing.revenue += (item.quantity || 0) * (item.unit_price || 0);
    productMap.set(key, existing);
  }
  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-pos-white/50">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando vendas do dia...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-pos-orange/20">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-pos-orange" />
          <h2 className="text-lg font-bold text-pos-white">Vendas</h2>
          <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/30">
            {completedSales.length} vendas
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-pos-white/60 hover:text-pos-white" onClick={goToPrevDay}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 text-xs min-w-[120px]">
                <CalendarIcon className="h-3.5 w-3.5" />
                {isToday ? "Hoje" : format(selectedDate, "dd/MM/yyyy")}
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
          <Button variant="ghost" size="icon" className="h-8 w-8 text-pos-white/60 hover:text-pos-white" onClick={goToNextDay} disabled={isToday}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button variant="outline" size="sm" className="text-xs border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 ml-1" onClick={goToToday}>
              Hoje
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10 ml-1" onClick={loadData}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KPICard icon={DollarSign} label="Faturamento" value={`R$ ${totalRevenue.toFixed(2)}`} color="text-green-400" />
            <KPICard icon={ShoppingCart} label="Vendas" value={String(completedSales.length)} color="text-pos-orange" />
            <KPICard icon={TrendingUp} label="Ticket Médio" value={`R$ ${avgTicket.toFixed(2)}`} color="text-blue-400" />
            <KPICard icon={Package} label="Itens Vendidos" value={String(totalItemsSold)} color="text-purple-400" />
            <KPICard icon={Tag} label="Preço Médio/Item" value={`R$ ${avgPricePerItem.toFixed(2)}`} color="text-yellow-400" />
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
                {sellerStats.map((s, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-pos-orange/20 flex items-center justify-center text-xs font-bold text-pos-orange">
                        {i + 1}º
                      </div>
                      <div>
                        <p className="font-medium text-sm text-pos-white">{s.name}</p>
                        <p className="text-xs text-pos-white/40">{s.count} venda{s.count > 1 ? "s" : ""}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm text-pos-orange">R$ {s.total.toFixed(2)}</p>
                      <p className="text-[10px] text-pos-white/40">ticket: R$ {(s.total / s.count).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
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
              <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
                <Package className="h-4 w-4 text-pos-orange" /> Produtos Mais Vendidos
              </h3>
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
            {completedSales.length === 0 ? (
              <div className="text-center py-12 text-pos-white/40">
                <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Nenhuma venda registrada hoje</p>
              </div>
            ) : (
              <div className="space-y-2">
                {completedSales.map((sale) => {
                  const sellerName = sellers.find((s) => s.id === sale.seller_id)?.name;
                  const time = new Date(sale.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={sale.id} className="flex items-center justify-between p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-pos-white/40 font-mono">{time}</span>
                        <div>
                          {sale.tiny_order_number ? (
                            <p className="text-xs text-pos-orange font-medium">#{sale.tiny_order_number}</p>
                          ) : (
                            <p className="text-xs text-red-400 font-medium">Sem Tiny</p>
                          )}
                          <p className="text-xs text-pos-white/50">
                            {sale.payment_method || "—"}
                            {sellerName && ` • ${sellerName}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
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
                          onClick={() => resendToTiny(sale)}
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
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function KPICard({ icon: Icon, label, value, color }: { icon: typeof DollarSign; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-pos-orange/10 bg-pos-white/5 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] uppercase tracking-wider text-pos-white/50 font-medium">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
