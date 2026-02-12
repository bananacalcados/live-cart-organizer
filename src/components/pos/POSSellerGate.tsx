import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Star, Trophy, TrendingUp, TrendingDown, Lightbulb, Zap, Target, Users } from 'lucide-react';
import { startOfDay, startOfWeek, endOfDay, endOfWeek } from 'date-fns';

interface Seller {
  id: string;
  name: string;
  tiny_seller_id?: string;
}

interface SellerStats {
  todaySales: number;
  todayRevenue: number;
  todayItems: number;
  weekSales: number;
  weekRevenue: number;
  weekItems: number;
  weeklyPoints: number;
  totalPoints: number;
  teamAvgTicket: number;
  teamAvgItems: number;
  sellerAvgTicket: number;
  sellerAvgItems: number;
  rank: number;
  totalSellers: number;
}

interface Props {
  storeId: string;
  sellers: Seller[];
  onSellerSelected: (sellerId: string) => void;
}

export function POSSellerGate({ storeId, sellers, onSellerSelected }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stats, setStats] = useState<SellerStats | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedSeller = sellers.find(s => s.id === selectedId);

  useEffect(() => {
    if (!selectedId) { setStats(null); return; }
    loadStats(selectedId);
  }, [selectedId]);

  const loadStats = async (sellerId: string) => {
    setLoading(true);
    try {
      const now = new Date();
      const dayStart = startOfDay(now).toISOString();
      const dayEnd = endOfDay(now).toISOString();
      const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString();
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString();

      // Run ALL queries in parallel
      const [todaySalesRes, weekSalesRes, allWeekSalesRes, gamRes, allGamRes] = await Promise.all([
        supabase.from('pos_sales').select('total, id').eq('store_id', storeId).eq('seller_id', sellerId)
          .gte('created_at', dayStart).lte('created_at', dayEnd).neq('status', 'cancelled'),
        supabase.from('pos_sales').select('total, id').eq('store_id', storeId).eq('seller_id', sellerId)
          .gte('created_at', weekStart).lte('created_at', weekEnd).neq('status', 'cancelled'),
        supabase.from('pos_sales').select('total, seller_id, id').eq('store_id', storeId)
          .gte('created_at', weekStart).lte('created_at', weekEnd).neq('status', 'cancelled'),
        supabase.from('pos_gamification').select('weekly_points, total_points')
          .eq('seller_id', sellerId).eq('store_id', storeId).maybeSingle(),
        supabase.from('pos_gamification').select('seller_id, weekly_points')
          .eq('store_id', storeId).order('weekly_points', { ascending: false }),
      ]);

      const todaySales = todaySalesRes.data || [];
      const weekSales = weekSalesRes.data || [];
      const allWeekSales = allWeekSalesRes.data || [];

      // Fetch items in parallel (only if there are sales)
      const todaySaleIds = todaySales.map(s => s.id);
      const weekSaleIds = weekSales.map(s => s.id);
      const allSaleIds = allWeekSales.map(s => s.id).slice(0, 500);

      const [todayItemsRes, weekItemsRes, allItemsRes] = await Promise.all([
        todaySaleIds.length > 0
          ? supabase.from('pos_sale_items').select('quantity').in('sale_id', todaySaleIds)
          : Promise.resolve({ data: [] }),
        weekSaleIds.length > 0
          ? supabase.from('pos_sale_items').select('quantity').in('sale_id', weekSaleIds)
          : Promise.resolve({ data: [] }),
        allSaleIds.length > 0
          ? supabase.from('pos_sale_items').select('quantity').in('sale_id', allSaleIds)
          : Promise.resolve({ data: [] }),
      ]);

      const todayItemsCount = (todayItemsRes.data || []).reduce((s: number, i: any) => s + (i.quantity || 0), 0);
      const weekItemsCount = (weekItemsRes.data || []).reduce((s: number, i: any) => s + (i.quantity || 0), 0);
      const allItemsCount = (allItemsRes.data || []).reduce((s: number, i: any) => s + (i.quantity || 0), 0);

      // Group by seller for averages
      const sellerGroups: Record<string, { total: number; count: number }> = {};
      for (const sale of allWeekSales) {
        if (!sale.seller_id) continue;
        if (!sellerGroups[sale.seller_id]) sellerGroups[sale.seller_id] = { total: 0, count: 0 };
        sellerGroups[sale.seller_id].total += parseFloat(String(sale.total || 0));
        sellerGroups[sale.seller_id].count += 1;
      }

      const activeSellers = Object.keys(sellerGroups).length || 1;
      const teamTotalTicket = Object.values(sellerGroups).reduce((s, g) => s + (g.count > 0 ? g.total / g.count : 0), 0);
      const teamAvgTicket = teamTotalTicket / activeSellers;
      const teamAvgItems = allSaleIds.length > 0 ? allItemsCount / allSaleIds.length : 0;

      const sellerWeekTotal = weekSales.reduce((s, sale) => s + parseFloat(String(sale.total || 0)), 0);
      const sellerWeekCount = weekSales.length;
      const sellerAvgTicket = sellerWeekCount > 0 ? sellerWeekTotal / sellerWeekCount : 0;
      const sellerAvgItems = sellerWeekCount > 0 ? weekItemsCount / sellerWeekCount : 0;

      const rankIndex = (allGamRes.data || []).findIndex(g => g.seller_id === sellerId);

      setStats({
        todaySales: todaySales.length,
        todayRevenue: todaySales.reduce((s, sale) => s + parseFloat(String(sale.total || 0)), 0),
        todayItems: todayItemsCount,
        weekSales: sellerWeekCount,
        weekRevenue: sellerWeekTotal,
        weekItems: weekItemsCount,
        weeklyPoints: gamRes.data?.weekly_points || 0,
        totalPoints: gamRes.data?.total_points || 0,
        teamAvgTicket,
        teamAvgItems,
        sellerAvgTicket,
        sellerAvgItems,
        rank: rankIndex >= 0 ? rankIndex + 1 : 0,
        totalSellers: (allGamRes.data || []).length,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getTicketTip = () => {
    if (!stats || stats.weekSales === 0) return null;
    const diff = stats.teamAvgTicket > 0 ? ((stats.sellerAvgTicket - stats.teamAvgTicket) / stats.teamAvgTicket) * 100 : 0;
    if (diff < -10) {
      return {
        icon: <TrendingDown className="h-4 w-4 text-red-400" />,
        color: 'border-red-500/30 bg-red-500/5',
        text: `Seu ticket médio está ${Math.abs(diff).toFixed(0)}% abaixo da equipe, ${selectedSeller?.name}. Tente oferecer acessórios ou peças complementares!`,
      };
    }
    if (diff > 10) {
      return {
        icon: <TrendingUp className="h-4 w-4 text-green-400" />,
        color: 'border-green-500/30 bg-green-500/5',
        text: `Arrasando! Seu ticket médio está ${diff.toFixed(0)}% acima da equipe, ${selectedSeller?.name}! 🔥`,
      };
    }
    return {
      icon: <Target className="h-4 w-4 text-pos-orange" />,
      color: 'border-pos-orange/30 bg-pos-orange/5',
      text: `Ticket médio alinhado com a equipe, ${selectedSeller?.name}. Vamos subir juntos! 💪`,
    };
  };

  const getItemsTip = () => {
    if (!stats || stats.weekSales === 0) return null;
    const diff = stats.teamAvgItems > 0 ? ((stats.sellerAvgItems - stats.teamAvgItems) / stats.teamAvgItems) * 100 : 0;
    if (diff < -10) {
      return {
        icon: <Lightbulb className="h-4 w-4 text-yellow-400" />,
        color: 'border-yellow-500/30 bg-yellow-500/5',
        text: `Seu número de itens por venda está ${Math.abs(diff).toFixed(0)}% abaixo da equipe, ${selectedSeller?.name}. Ofereça mais pares ao mesmo cliente! 👟`,
      };
    }
    return null;
  };

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent className="bg-pos-black border-pos-orange/30 text-pos-white max-w-lg [&>button]:hidden" onPointerDownOutside={e => e.preventDefault()}>
        {!selectedId ? (
          <div className="space-y-6 py-2">
            <div className="text-center">
              <div className="h-16 w-16 mx-auto rounded-full bg-pos-orange/20 flex items-center justify-center mb-3">
                <Users className="h-8 w-8 text-pos-orange" />
              </div>
              <h2 className="text-xl font-bold text-pos-white">Quem vai vender?</h2>
              <p className="text-sm text-pos-white/50 mt-1">Selecione sua vendedora para começar</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {sellers.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className="p-4 rounded-xl border-2 border-pos-white/10 bg-pos-white/5 hover:border-pos-orange hover:bg-pos-orange/10 transition-all text-center"
                >
                  <div className="h-10 w-10 mx-auto rounded-full bg-pos-orange/20 flex items-center justify-center mb-2 text-pos-orange font-bold">
                    {s.name.charAt(0)}
                  </div>
                  <p className="font-medium text-sm text-pos-white">{s.name}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="text-center">
              <h2 className="text-xl font-bold text-pos-white">
                Seja bem-vinda, {selectedSeller?.name}! 🎉
              </h2>
              {stats && (
                <div className="flex items-center justify-center gap-2 mt-2">
                  <Star className="h-5 w-5 text-pos-orange" />
                  <span className="text-lg font-bold text-pos-orange">{stats.weeklyPoints} pts</span>
                  <span className="text-xs text-pos-white/40">(semana)</span>
                  {stats.rank > 0 && (
                    <span className="text-xs text-pos-white/40">
                      • #{stats.rank} de {stats.totalSellers}
                    </span>
                  )}
                </div>
              )}
            </div>

            {loading ? (
              <div className="text-center py-4 text-pos-white/50 text-sm">Carregando suas métricas...</div>
            ) : stats ? (
              <>
                {/* Today stats */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-pos-white/5 border border-pos-white/10 p-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-pos-white/40">Vendas Hoje</p>
                    <p className="text-xl font-bold text-pos-white">{stats.todaySales}</p>
                  </div>
                  <div className="rounded-lg bg-pos-white/5 border border-pos-white/10 p-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-pos-white/40">Faturamento</p>
                    <p className="text-xl font-bold text-pos-orange">R$ {stats.todayRevenue.toFixed(0)}</p>
                  </div>
                  <div className="rounded-lg bg-pos-white/5 border border-pos-white/10 p-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-pos-white/40">Itens</p>
                    <p className="text-xl font-bold text-pos-white">{stats.todayItems}</p>
                  </div>
                </div>

                {/* Tips */}
                {getTicketTip() && (
                  <div className={`rounded-xl border p-3 ${getTicketTip()!.color}`}>
                    <div className="flex items-start gap-2">
                      {getTicketTip()!.icon}
                      <p className="text-xs text-pos-white/80">{getTicketTip()!.text}</p>
                    </div>
                  </div>
                )}
                {getItemsTip() && (
                  <div className={`rounded-xl border p-3 ${getItemsTip()!.color}`}>
                    <div className="flex items-start gap-2">
                      {getItemsTip()!.icon}
                      <p className="text-xs text-pos-white/80">{getItemsTip()!.text}</p>
                    </div>
                  </div>
                )}

                {/* Motivational */}
                <div className="rounded-xl border border-pos-orange/30 bg-pos-orange/5 p-3 text-center">
                  <Zap className="h-5 w-5 text-pos-orange mx-auto mb-1" />
                  <p className="text-xs text-pos-white/70">
                    {stats.weekSales === 0
                      ? `Bora começar forte hoje, ${selectedSeller?.name}! Cada venda vale pontos! 🚀`
                      : stats.rank <= 1
                        ? `Você está liderando o ranking, ${selectedSeller?.name}! Mantenha o ritmo! 👑`
                        : `Faltam ${((stats.rank - 1) * 10)} pts para o topo. Vamos nessa, ${selectedSeller?.name}! 💪`}
                  </p>
                </div>
              </>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-pos-white/20 text-pos-white/70 hover:bg-pos-white/10 bg-transparent"
                onClick={() => setSelectedId(null)}
              >
                Voltar
              </Button>
              <Button
                className="flex-1 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold"
                onClick={() => onSellerSelected(selectedId)}
              >
                Começar a Vender! 🔥
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
