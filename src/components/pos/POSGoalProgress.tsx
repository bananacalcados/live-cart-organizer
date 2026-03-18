import { useState, useEffect } from "react";
import { Target, TrendingUp, DollarSign, Package, Users, Trophy, Gift } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface Goal {
  id: string;
  goal_type: string;
  goal_value: number;
  period: string;
  seller_id: string | null;
  goal_category?: string | null;
  goal_brand?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  prize_label?: string | null;
  prize_value?: number | null;
  prize_type?: string | null;
}

interface GoalProgressRow {
  goal_id: string;
  seller_id: string | null;
  current_value: number;
}

interface Props {
  storeId: string;
  totalRevenue: number;
  avgTicket: number;
  avgItemsPerSale: number;
  salesCount: number;
  period: string;
  sellerMetrics?: { name: string; totalSales: number; salesCount: number; totalItems: number; sellerId?: string }[];
}

const goalTypeLabels: Record<string, string> = {
  revenue: "Faturamento",
  avg_ticket: "Ticket Médio",
  items_sold: "Itens por Venda",
  seller_revenue: "Faturamento Vendedor",
  points: "Pontos",
  category_units: "Meta por Categoria",
  brand_units: "Meta por Marca",
};

const goalTypeIcons: Record<string, typeof DollarSign> = {
  revenue: DollarSign,
  avg_ticket: TrendingUp,
  items_sold: Package,
  seller_revenue: Users,
  points: Trophy,
  category_units: Target,
  brand_units: Trophy,
};

const periodLabels: Record<string, string> = {
  daily: "Diária",
  weekly: "Semanal",
  monthly: "Mensal",
  custom: "Personalizado",
};

function mapPeriodToFilter(goal: Goal, dashPeriod: string): boolean {
  if (goal.period === "custom") return true;
  if (goal.goal_type === "category_units" || goal.goal_type === "brand_units" || goal.goal_type === "points") return true;
  if (goal.period === "daily" && dashPeriod === "day") return true;
  if (goal.period === "weekly" && dashPeriod === "week") return true;
  if (goal.period === "monthly") return true;
  return false;
}

export function POSGoalProgress({ storeId, totalRevenue, avgTicket, avgItemsPerSale, salesCount, period, sellerMetrics }: Props) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalProgress, setGoalProgress] = useState<GoalProgressRow[]>([]);
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const load = async () => {
      const [goalsRes, progressRes, sellersRes] = await Promise.all([
        supabase.from("pos_goals").select("*").eq("store_id", storeId).eq("is_active", true),
        supabase.from("pos_goal_progress" as any).select("goal_id, seller_id, current_value"),
        supabase.from("pos_sellers").select("id, name").eq("store_id", storeId).eq("is_active", true),
      ]);
      setGoals(goalsRes.data || []);
      setGoalProgress((progressRes.data as any[]) || []);
      setSellers(sellersRes.data || []);
    };
    load();
  }, [storeId]);

  // Filter goals matching the current dashboard period
  const relevantGoals = goals.filter(g => mapPeriodToFilter(g, period));

  if (relevantGoals.length === 0) return null;

  const getCurrentValue = (goal: Goal): number => {
    // For category/brand goals, use progress table
    if (goal.goal_type === "category_units" || goal.goal_type === "brand_units") {
      const progress = goalProgress.filter(p => p.goal_id === goal.id);
      return progress.reduce((sum, p) => sum + (p.current_value || 0), 0);
    }

    switch (goal.goal_type) {
      case "revenue":
        return totalRevenue;
      case "avg_ticket":
        return avgTicket;
      case "items_sold":
        return avgItemsPerSale;
      case "seller_revenue":
        if (goal.seller_id && sellerMetrics) {
          const seller = sellerMetrics.find(s => s.sellerId === goal.seller_id);
          return seller?.totalSales || 0;
        }
        return totalRevenue;
      default:
        return 0;
    }
  };

  const formatValue = (type: string, value: number): string => {
    if (type === "items_sold") return value.toFixed(1);
    if (type === "category_units" || type === "brand_units") return `${Math.floor(value)} pares`;
    return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  };

  const getGoalLabel = (goal: Goal): string => {
    if (goal.goal_type === "category_units" && goal.goal_category) {
      return `Categoria: ${goal.goal_category}`;
    }
    if (goal.goal_type === "brand_units" && goal.goal_brand) {
      return `Marca: ${goal.goal_brand}`;
    }
    return goalTypeLabels[goal.goal_type] || goal.goal_type;
  };

  const getPeriodLabel = (goal: Goal): string => {
    if (goal.period === "custom" && goal.period_start && goal.period_end) {
      const start = new Date(goal.period_start).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      const end = new Date(goal.period_end).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      return `${start} - ${end}`;
    }
    return periodLabels[goal.period] || goal.period;
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
        <Target className="h-4 w-4 text-pos-orange" /> Progresso das Metas
      </h3>
      <div className="space-y-2">
        {relevantGoals.map(goal => {
          const Icon = goalTypeIcons[goal.goal_type] || Target;
          const current = getCurrentValue(goal);
          const pct = goal.goal_value > 0 ? Math.min(100, (current / goal.goal_value) * 100) : 0;
          const achieved = pct >= 100;
          const remaining = Math.max(0, goal.goal_value - current);
          const sellerName = goal.seller_id ? sellers.find(s => s.id === goal.seller_id)?.name : null;

          return (
            <div key={goal.id} className={`p-3 rounded-lg border ${achieved ? "bg-green-500/10 border-green-500/30" : "bg-pos-white/5 border-pos-orange/10"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${achieved ? "text-green-400" : "text-pos-orange"}`} />
                  <span className="text-xs font-medium text-pos-white">{getGoalLabel(goal)}</span>
                  <Badge className="text-[10px] bg-pos-orange/20 text-pos-orange border-pos-orange/30">
                    {getPeriodLabel(goal)}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${achieved ? "text-green-400" : "text-pos-orange"}`}>
                    {formatValue(goal.goal_type, current)}
                  </span>
                  <span className="text-[10px] text-pos-white/40">
                    / {formatValue(goal.goal_type, goal.goal_value)}
                  </span>
                </div>
              </div>
              <Progress
                value={pct}
                className={`h-2 ${achieved ? "[&>div]:bg-green-500" : "[&>div]:bg-pos-orange"} bg-pos-white/10`}
              />
              <div className="flex items-center justify-between mt-1">
                <span className={`text-[10px] font-bold ${achieved ? "text-green-400" : pct >= 75 ? "text-pos-orange" : pct >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                  {pct.toFixed(0)}%
                </span>
                {!achieved && goal.prize_label && sellerName && (
                  <span className="text-[10px] text-black font-black animate-pulse">
                    🏆 FALTA {formatValue(goal.goal_type, remaining)} PARA {sellerName.toUpperCase()} GANHAR: {goal.prize_label}
                  </span>
                )}
                {!achieved && goal.prize_label && !sellerName && (
                  <span className="text-[10px] text-black font-black">
                    🏆 Prêmio: {goal.prize_label}
                  </span>
                )}
                {!achieved && !goal.prize_label && (
                  <span className="text-[10px] text-pos-white/40">
                    Faltam {formatValue(goal.goal_type, remaining)}
                  </span>
                )}
                {achieved && (
                  <span className="text-[10px] text-green-400 font-bold">
                    ✅ Meta atingida! {goal.prize_label && `🎁 ${goal.prize_label}`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
