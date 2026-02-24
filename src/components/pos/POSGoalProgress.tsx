import { useState, useEffect } from "react";
import { Target, TrendingUp, DollarSign, Package, Users } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface Goal {
  id: string;
  goal_type: string;
  goal_value: number;
  period: string;
  seller_id: string | null;
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
  items_sold: "Itens Vendidos",
  seller_revenue: "Faturamento Vendedor",
};

const goalTypeIcons: Record<string, typeof DollarSign> = {
  revenue: DollarSign,
  avg_ticket: TrendingUp,
  items_sold: Package,
  seller_revenue: Users,
};

const periodLabels: Record<string, string> = {
  daily: "Diária",
  weekly: "Semanal",
  monthly: "Mensal",
};

function mapPeriodToFilter(goalPeriod: string, dashPeriod: string): boolean {
  if (goalPeriod === "daily" && dashPeriod === "day") return true;
  if (goalPeriod === "weekly" && dashPeriod === "week") return true;
  if (goalPeriod === "monthly" && dashPeriod === "month") return true;
  return false;
}

export function POSGoalProgress({ storeId, totalRevenue, avgTicket, avgItemsPerSale, salesCount, period, sellerMetrics }: Props) {
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("pos_goals")
        .select("*")
        .eq("store_id", storeId)
        .eq("is_active", true);
      setGoals(data || []);
    };
    load();
  }, [storeId]);

  // Filter goals matching the current dashboard period
  const relevantGoals = goals.filter(g => mapPeriodToFilter(g.period, period));

  if (relevantGoals.length === 0) return null;

  const getCurrentValue = (goal: Goal): number => {
    switch (goal.goal_type) {
      case "revenue":
        return totalRevenue;
      case "avg_ticket":
        return avgTicket;
      case "items_sold":
        return salesCount > 0 ? avgItemsPerSale * salesCount : 0;
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
    if (type === "items_sold") return Math.round(value).toString();
    return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-pos-white flex items-center gap-2">
        <Target className="h-4 w-4 text-pos-orange" /> Progresso das Metas
        <Badge className="bg-pos-orange/20 text-pos-orange border-pos-orange/30 text-[10px]">
          {periodLabels[relevantGoals[0]?.period] || period}
        </Badge>
      </h3>
      <div className="space-y-2">
        {relevantGoals.map(goal => {
          const Icon = goalTypeIcons[goal.goal_type] || Target;
          const current = getCurrentValue(goal);
          const pct = goal.goal_value > 0 ? Math.min(100, (current / goal.goal_value) * 100) : 0;
          const achieved = pct >= 100;

          return (
            <div key={goal.id} className={`p-3 rounded-lg border ${achieved ? "bg-green-500/10 border-green-500/30" : "bg-pos-white/5 border-pos-orange/10"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${achieved ? "text-green-400" : "text-pos-orange"}`} />
                  <span className="text-xs font-medium text-pos-white">{goalTypeLabels[goal.goal_type]}</span>
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
                {!achieved && (
                  <span className="text-[10px] text-pos-white/40">
                    Faltam {formatValue(goal.goal_type, Math.max(0, goal.goal_value - current))}
                  </span>
                )}
                {achieved && (
                  <span className="text-[10px] text-green-400 font-bold">
                    ✅ Meta atingida!
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
