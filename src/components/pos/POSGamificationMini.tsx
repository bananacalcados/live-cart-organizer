import { useState, useEffect } from "react";
import { Trophy, Star, Medal, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  storeId: string;
}

interface GamificationEntry {
  id: string;
  seller_id: string;
  total_points: number;
  weekly_points: number;
  total_sales: number;
  complete_registrations: number;
  fast_requests_answered: number;
  returns_count: number;
  seller_name?: string;
}

export function POSGamificationMini({ storeId }: Props) {
  const [entries, setEntries] = useState<GamificationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGamification();
  }, [storeId]);

  const loadGamification = async () => {
    try {
      const { data, error } = await supabase
        .from('pos_gamification')
        .select('*, pos_sellers(name)')
        .eq('store_id', storeId)
        .order('weekly_points', { ascending: false });
      if (error) throw error;
      setEntries((data || []).map((e: any) => ({
        ...e,
        seller_name: e.pos_sellers?.name || 'Vendedora',
      })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getMedalColor = (index: number) => {
    if (index === 0) return "text-yellow-400";
    if (index === 1) return "text-gray-300";
    if (index === 2) return "text-amber-600";
    return "text-pos-white/30";
  };

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div>
        <h2 className="text-lg font-bold text-pos-white flex items-center gap-2">
          <Trophy className="h-5 w-5 text-pos-orange" /> Gamificação
        </h2>
        <p className="text-sm text-pos-white/50">Ranking semanal das vendedoras</p>
      </div>

      {loading ? (
        <div className="text-center py-8 text-pos-white/50">Carregando...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Trophy className="h-16 w-16 mx-auto text-pos-orange/30" />
          <p className="text-pos-white/50">Nenhuma pontuação registrada ainda</p>
          <p className="text-xs text-pos-white/30">Cadastre vendedoras e comece a pontuar!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, i) => (
            <div key={entry.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
              i === 0 ? 'border-pos-orange/50 bg-pos-orange/5 shadow-[0_0_15px_hsl(25_100%_50%/0.1)]' : 'border-pos-white/10 bg-pos-white/5'
            }`}>
              <div className="flex items-center justify-center w-8">
                {i < 3 ? (
                  <Medal className={`h-6 w-6 ${getMedalColor(i)}`} />
                ) : (
                  <span className="text-lg font-bold text-pos-white/30">{i + 1}</span>
                )}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-pos-white">{entry.seller_name}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-pos-white/40">
                  <span>{entry.total_sales} vendas</span>
                  <span>{entry.complete_registrations} cadastros</span>
                  <span>{entry.fast_requests_answered} rápidas</span>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1 text-pos-orange font-bold">
                  <Star className="h-4 w-4" />
                  {entry.weekly_points} pts
                </div>
                <p className="text-[10px] text-pos-white/30">Total: {entry.total_points}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Scoring rules */}
      <div className="rounded-xl bg-pos-white/5 border border-pos-orange/20 p-4 space-y-2">
        <h4 className="text-xs font-bold text-pos-orange uppercase tracking-wider">Como pontuar</h4>
        <div className="space-y-1 text-xs text-pos-white/60">
          <div className="flex justify-between"><span>Cadastro completo (100%)</span><span className="text-pos-orange font-bold">+10 pts</span></div>
          <div className="flex justify-between"><span>Cadastro parcial (50%+)</span><span className="text-pos-orange font-bold">+5 pts</span></div>
          <div className="flex justify-between"><span>Venda realizada</span><span className="text-pos-orange font-bold">+3 pts</span></div>
          <div className="flex justify-between"><span>Venda Queima de Estoque</span><span className="text-pos-orange font-bold">+20 pts</span></div>
          <div className="flex justify-between"><span>Solicitação atendida &lt;5min</span><span className="text-pos-orange font-bold">+5 pts</span></div>
          <div className="flex justify-between"><span>Troca/devolução por defeito</span><span className="text-red-400 font-bold">-2 pts</span></div>
        </div>
      </div>
    </div>
  );
}
