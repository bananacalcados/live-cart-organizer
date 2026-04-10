import { useState, useEffect, useMemo } from "react";
import { Target, TrendingUp, DollarSign, Package, Users, Trophy, Gift, Calendar } from "lucide-react";
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

interface GamificationRow {
  seller_id: string;
  weekly_points: number;
  total_points: number;
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

// Brazilian national holidays (fixed dates)
function getBrazilianHolidays(year: number): Set<string> {
  const fixed = [
    `${year}-01-01`, // Confraternização Universal
    `${year}-04-21`, // Tiradentes
    `${year}-05-01`, // Dia do Trabalho
    `${year}-09-07`, // Independência
    `${year}-10-12`, // Nossa Senhora Aparecida
    `${year}-11-02`, // Finados
    `${year}-11-15`, // Proclamação da República
    `${year}-12-25`, // Natal
  ];

  // Easter-based holidays (Pascoa algorithm)
  const easter = getEasterDate(year);
  const carnaval = addDays(easter, -47); // Terça de Carnaval
  const carnavalSeg = addDays(easter, -48); // Segunda de Carnaval
  const sextaSanta = addDays(easter, -2); // Sexta-feira Santa
  const corpusChristi = addDays(easter, 60); // Corpus Christi

  const mobile = [carnaval, carnavalSeg, sextaSanta, corpusChristi].map(d => formatDateKey(d));

  return new Set([...fixed, ...mobile]);
}

function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Count business days (Mon-Sat) excluding holidays between two dates (inclusive) */
function countBusinessDays(start: Date, end: Date, holidays: Set<string>): number {
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);
  while (cur <= endDate) {
    const dow = cur.getDay(); // 0=Sun
    if (dow !== 0) {
      // Mon-Sat
      const key = formatDateKey(cur);
      if (!holidays.has(key)) {
        count++;
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

interface MonthlyPaceInfo {
  monthRevenue: number;
  totalBusinessDays: number;
  elapsedBusinessDays: number;
  expectedRevenue: number;
  dailyTarget: number;
  diff: number; // positive = ahead, negative = behind
  pctOfExpected: number;
  sellerMonthRevenues: Record<string, number>;
}

export function POSGoalProgress({ storeId, totalRevenue, avgTicket, avgItemsPerSale, salesCount, period, sellerMetrics }: Props) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalProgress, setGoalProgress] = useState<GoalProgressRow[]>([]);
  const [gamificationData, setGamificationData] = useState<GamificationRow[]>([]);
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [monthlyPace, setMonthlyPace] = useState<MonthlyPaceInfo | null>(null);

  useEffect(() => {
    const load = async () => {
      const [goalsRes, progressRes, sellersRes, gamRes] = await Promise.all([
        supabase.from("pos_goals").select("*").eq("store_id", storeId).eq("is_active", true),
        supabase.from("pos_goal_progress" as any).select("goal_id, seller_id, current_value"),
        supabase.from("pos_sellers").select("id, name").eq("store_id", storeId).eq("is_active", true),
        supabase.from("pos_gamification").select("seller_id, weekly_points, total_points").eq("store_id", storeId),
      ]);
      setGoals(goalsRes.data || []);
      setGoalProgress((progressRes.data as any[]) || []);
      setSellers(sellersRes.data || []);
      setGamificationData((gamRes.data as GamificationRow[]) || []);
    };
    load();
  }, [storeId]);

  // Check if there are monthly revenue/seller_revenue goals
  const hasMonthlyRevenueGoals = useMemo(() => {
    return goals.some(g => g.period === "monthly" && (g.goal_type === "revenue" || g.goal_type === "seller_revenue"));
  }, [goals]);

  // Fetch monthly accumulated revenue when needed
  useEffect(() => {
    if (!hasMonthlyRevenueGoals) {
      setMonthlyPace(null);
      return;
    }

    const fetchMonthRevenue = async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0); // last day of month
      const today = new Date(year, month, now.getDate());

      const holidays = getBrazilianHolidays(year);
      const totalBizDays = countBusinessDays(monthStart, monthEnd, holidays);
      const elapsedBizDays = countBusinessDays(monthStart, today, holidays);

      const startStr = formatDateKey(monthStart);
      const endStr = `${formatDateKey(today)}T23:59:59`;

      // Fetch completed sales for the entire month so far
      const { data: salesData } = await supabase
        .from("pos_sales")
        .select("total, seller_id")
        .eq("store_id", storeId)
        .eq("status", "completed")
        .gte("created_at", startStr)
        .lte("created_at", endStr);

      const monthRev = (salesData || []).reduce((s, r) => s + (r.total || 0), 0);

      // Per-seller revenues
      const sellerRevs: Record<string, number> = {};
      (salesData || []).forEach(s => {
        if (s.seller_id) {
          sellerRevs[s.seller_id] = (sellerRevs[s.seller_id] || 0) + (s.total || 0);
        }
      });

      const dailyTarget = totalBizDays > 0 ? 0 : 0; // will be calculated per goal
      const expectedRev = 0; // calculated per goal

      setMonthlyPace({
        monthRevenue: monthRev,
        totalBusinessDays: totalBizDays,
        elapsedBusinessDays: elapsedBizDays,
        expectedRevenue: expectedRev,
        dailyTarget: dailyTarget,
        diff: 0,
        pctOfExpected: 0,
        sellerMonthRevenues: sellerRevs,
      });
    };

    fetchMonthRevenue();
  }, [storeId, hasMonthlyRevenueGoals, goals]);

  // Filter goals matching the current dashboard period
  const relevantGoals = goals.filter(g => mapPeriodToFilter(g, period));

  if (relevantGoals.length === 0) return null;

  const isMonthlyRevenueGoal = (goal: Goal) =>
    goal.period === "monthly" && (goal.goal_type === "revenue" || goal.goal_type === "seller_revenue");

  const getCurrentValue = (goal: Goal): number => {
    // For monthly revenue goals, always use month-accumulated data
    if (isMonthlyRevenueGoal(goal) && monthlyPace) {
      if (goal.goal_type === "seller_revenue" && goal.seller_id) {
        return monthlyPace.sellerMonthRevenues[goal.seller_id] || 0;
      }
      return monthlyPace.monthRevenue;
    }

    // For points goals, read directly from pos_gamification (source of truth)
    if (goal.goal_type === "points") {
      if (goal.seller_id) {
        const sellerGam = gamificationData.find(g => g.seller_id === goal.seller_id);
        return sellerGam?.weekly_points || 0;
      }
      return gamificationData.reduce((sum, g) => sum + (g.weekly_points || 0), 0);
    }

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

  const getMonthlyPaceForGoal = (goal: Goal) => {
    if (!isMonthlyRevenueGoal(goal) || !monthlyPace) return null;

    const { totalBusinessDays, elapsedBusinessDays } = monthlyPace;
    if (totalBusinessDays === 0) return null;

    const dailyTarget = goal.goal_value / totalBusinessDays;
    const expectedSoFar = dailyTarget * elapsedBusinessDays;
    const currentMonthVal = goal.goal_type === "seller_revenue" && goal.seller_id
      ? (monthlyPace.sellerMonthRevenues[goal.seller_id] || 0)
      : monthlyPace.monthRevenue;
    const diff = currentMonthVal - expectedSoFar;
    const pctOfExpected = expectedSoFar > 0 ? (currentMonthVal / expectedSoFar) * 100 : 0;

    return {
      dailyTarget,
      expectedSoFar,
      diff,
      pctOfExpected,
      totalBusinessDays,
      elapsedBusinessDays,
    };
  };

  const formatValue = (type: string, value: number): string => {
    if (type === "items_sold") return value.toFixed(1);
    if (type === "points") return `${Math.floor(value)} pts`;
    if (type === "category_units" || type === "brand_units") return `${Math.floor(value)} pares`;
    return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  };

  const formatCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

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
          const pace = getMonthlyPaceForGoal(goal);

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

              {/* Monthly Pace Bar */}
              {pace && (
                <div className="mt-3 pt-2 border-t border-pos-white/10">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 text-pos-white/60" />
                      <span className="text-[10px] text-pos-white/60">
                        Ritmo Mensal ({pace.elapsedBusinessDays}/{pace.totalBusinessDays} dias úteis)
                      </span>
                    </div>
                    <span className="text-[10px] text-pos-white/40">
                      Meta/dia: {formatCurrency(pace.dailyTarget)}
                    </span>
                  </div>

                  {/* Expected vs Actual bar */}
                  <div className="relative">
                    <Progress
                      value={Math.min(100, pace.pctOfExpected)}
                      className={`h-2.5 ${
                        pace.diff >= 0
                          ? "[&>div]:bg-green-500"
                          : "[&>div]:bg-red-500"
                      } bg-pos-white/10`}
                    />
                    {/* Expected marker line */}
                    <div
                      className="absolute top-0 h-2.5 w-0.5 bg-pos-white/70 rounded"
                      style={{ left: `${Math.min(100, (pace.elapsedBusinessDays / pace.totalBusinessDays) * 100)}%` }}
                      title={`Esperado: ${formatCurrency(pace.expectedSoFar)}`}
                    />
                  </div>

                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[10px] font-bold ${
                      pace.diff >= 0 ? "text-green-400" : "text-red-400"
                    }`}>
                      {pace.diff >= 0
                        ? `✅ +${formatCurrency(pace.diff)} acima do esperado`
                        : `⚠️ ${formatCurrency(Math.abs(pace.diff))} abaixo do esperado`
                      }
                    </span>
                    <span className="text-[10px] text-pos-white/40">
                      Esperado: {formatCurrency(pace.expectedSoFar)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
