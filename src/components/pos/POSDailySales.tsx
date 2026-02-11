import { useState, useEffect } from "react";
import {
  DollarSign, ShoppingCart, Tag, Users, TrendingUp,
  Package, Loader2, RefreshCw, BarChart3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";

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

  const loadData = async () => {
    setLoading(true);
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [salesRes, itemsRes, sellersRes] = await Promise.all([
        supabase
          .from("pos_sales")
          .select("id, created_at, subtotal, discount, total, payment_method, seller_id, status, tiny_order_number")
          .eq("store_id", storeId)
          .gte("created_at", todayStart.toISOString())
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

  useEffect(() => {
    loadData();
  }, [storeId]);

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
          <h2 className="text-lg font-bold text-pos-white">Vendas do Dia</h2>
          <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/30">
            {completedSales.length} vendas
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 border-pos-orange/30 text-pos-orange hover:bg-pos-orange/10"
          onClick={loadData}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
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
                          {sale.tiny_order_number && (
                            <p className="text-xs text-pos-orange font-medium">#{sale.tiny_order_number}</p>
                          )}
                          <p className="text-xs text-pos-white/50">
                            {sale.payment_method || "—"}
                            {sellerName && ` • ${sellerName}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-pos-white">R$ {(sale.total || 0).toFixed(2)}</p>
                        {sale.discount > 0 && (
                          <p className="text-[10px] text-red-400">-R$ {sale.discount.toFixed(2)}</p>
                        )}
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
