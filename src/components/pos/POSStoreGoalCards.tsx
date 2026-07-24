import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarRange, CalendarClock, Loader2, ChevronDown, ChevronRight, CheckCircle2, Circle, TrendingUp, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getBrazilianHolidays, countBusinessDays, parseLocalDate, formatDateKey } from "@/lib/businessDays";

const BRL = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const REVENUE_STATUSES = ["completed", "pending_sync", "paid"];

// Degraus de meta escalonada exibidos em cada card.
const TIER_PERCENTS = [80, 90, 100, 110, 120];

// Janela de expediente usada para estimar o "ritmo" do dia corrente.
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 19;

interface Props {
  storeId: string;
}

interface StoreGoalState {
  monthlyGoal: number;
  dayDone: number;
  weekDone: number;
  monthDone: number;
  businessDaysInMonth: number;
  weeksInMonth: number;
  // Pacing (quanto já deveríamos ter faturado até agora)
  businessDaysElapsedMonth: number; // dias úteis já COMPLETOS antes de hoje no mês
  businessDaysInWeek: number;
  businessDaysElapsedWeek: number; // dias úteis já COMPLETOS antes de hoje na semana
  dayFraction: number; // 0-1 fração do expediente já decorrida hoje
  isTodayBusinessDay: boolean;
}

/** Número de semanas (linhas de calendário, domingo→sábado) que o mês ocupa. */
function weeksInMonth(ref: Date): number {
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const firstDow = new Date(year, month, 1).getDay(); // 0 = domingo
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.ceil((firstDow + daysInMonth) / 7);
}

/** Segunda-feira da semana corrente (00:00). */
function startOfCurrentWeek(ref: Date): Date {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0 = domingo
  const diff = dow === 0 ? 6 : dow - 1; // segunda como início
  d.setDate(d.getDate() - diff);
  return d;
}

/** Fração do expediente (9h-19h) já decorrida no momento atual (0-1). */
function currentDayFraction(now: Date): number {
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = WORK_START_HOUR * 60;
  const end = WORK_END_HOUR * 60;
  if (mins <= start) return 0;
  if (mins >= end) return 1;
  return (mins - start) / (end - start);
}

/**
 * Painel de metas da LOJA no topo do dashboard, no mesmo padrão visual dos KPIs.
 * Mostra três metas — Dia, Semana e Mês — com o quanto já foi feito, quanto
 * falta (com destaque) e quanto já deveríamos ter faturado (ritmo). Cada card
 * pode ser expandido para mostrar as metas escalonadas (80/90/100/110/120%).
 */
export function POSStoreGoalCards({ storeId }: Props) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<StoreGoalState | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = startOfCurrentWeek(now);
        const endIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

        const [goalsRes, salesRes] = await Promise.all([
          supabase.from("pos_goals")
            .select("goal_value, period, period_start, period_end, created_at")
            .eq("store_id", storeId).eq("is_active", true)
            .eq("goal_type", "revenue").is("seller_id", null),
          supabase.from("pos_sales")
            .select("total, paid_at, created_at")
            .eq("store_id", storeId)
            .eq("expedition_stage", "concluido")
            .in("status", REVENUE_STATUSES)
            .neq("revenue_attribution", "site_pickup_only")
            .or(`and(paid_at.gte.${monthStart.toISOString()},paid_at.lte.${endIso}),and(paid_at.is.null,created_at.gte.${monthStart.toISOString()},created_at.lte.${endIso})`)
            .limit(20000),
        ]);

        // Meta mensal da loja: prioriza custom vigente, senão a monthly mais recente.
        const goals = (goalsRes.data || []) as any[];
        const today0 = new Date(); today0.setHours(0, 0, 0, 0);
        const validCustoms = goals.filter((g) => {
          if (g.period !== "custom") return false;
          if (!g.period_start || !g.period_end) return true;
          const s = parseLocalDate(g.period_start);
          const e = parseLocalDate(g.period_end); e.setHours(23, 59, 59, 999);
          return today0 >= s && today0 <= e;
        });
        const monthlies = goals.filter((g) => g.period === "monthly");
        const pool = validCustoms.length > 0 ? validCustoms : monthlies;
        pool.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
        const monthlyGoal = pool.length > 0 ? Number(pool[0].goal_value) || 0 : 0;

        let dayDone = 0, weekDone = 0, monthDone = 0;
        for (const s of (salesRes.data || []) as any[]) {
          const total = Number(s.total) || 0;
          const eff = s.paid_at ? new Date(s.paid_at) : new Date(s.created_at);
          monthDone += total;
          if (eff >= weekStart) weekDone += total;
          if (eff >= todayStart) dayDone += total;
        }

        const holidays = getBrazilianHolidays(now.getFullYear());
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const bizDays = countBusinessDays(monthStart, monthEnd, holidays) || 1;

        // Semana corrente: seg→sáb (recorta ao intervalo do mês exibido não é
        // necessário; a meta semanal usa dias úteis da própria semana).
        const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 5); // sábado
        const bizDaysWeek = countBusinessDays(weekStart, weekEnd, holidays) || 1;

        // Dias úteis JÁ COMPLETOS (antes de hoje) no mês e na semana.
        const yesterday = new Date(todayStart); yesterday.setDate(yesterday.getDate() - 1);
        const bizElapsedMonth = todayStart > monthStart
          ? countBusinessDays(monthStart, yesterday, holidays)
          : 0;
        const bizElapsedWeek = todayStart > weekStart
          ? countBusinessDays(weekStart, yesterday, holidays)
          : 0;

        const isTodayBusinessDay = now.getDay() !== 0 && !holidays.has(formatDateKey(now));
        const dayFraction = isTodayBusinessDay ? currentDayFraction(now) : 1;

        if (!cancelled) {
          setState({
            monthlyGoal,
            dayDone,
            weekDone,
            monthDone,
            businessDaysInMonth: bizDays,
            weeksInMonth: weeksInMonth(now) || 1,
            businessDaysElapsedMonth: bizElapsedMonth,
            businessDaysInWeek: bizDaysWeek,
            businessDaysElapsedWeek: bizElapsedWeek,
            dayFraction,
            isTodayBusinessDay,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [storeId]);

  const cards = useMemo(() => {
    if (!state) return [];
    const dailyGoal = state.monthlyGoal / state.businessDaysInMonth;
    // Meta da semana = meta diária × dias úteis da SEMANA corrente. Assim
    // semanas curtas (início/fim de mês) não recebem meta inflada.
    const weeklyGoal = dailyGoal * state.businessDaysInWeek;

    // Ritmo: quanto já deveríamos ter faturado até agora em cada período.
    const todayContribution = state.isTodayBusinessDay ? state.dayFraction : 0;
    const dayExpected = dailyGoal * state.dayFraction;
    const weekExpected = weeklyGoal *
      Math.min(1, (state.businessDaysElapsedWeek + todayContribution) / state.businessDaysInWeek);
    const monthExpected = state.monthlyGoal *
      Math.min(1, (state.businessDaysElapsedMonth + todayContribution) / state.businessDaysInMonth);

    return [
      {
        key: "day",
        icon: CalendarDays,
        label: "Meta do Dia",
        goal: dailyGoal,
        done: state.dayDone,
        expected: dayExpected,
        hint: `meta mensal ÷ ${state.businessDaysInMonth} dias úteis`,
      },
      {
        key: "week",
        icon: CalendarRange,
        label: "Meta da Semana",
        goal: weeklyGoal,
        done: state.weekDone,
        expected: weekExpected,
        hint: `meta diária × ${state.businessDaysInWeek} dias úteis da semana`,
      },
      {
        key: "month",
        icon: CalendarClock,
        label: "Meta do Mês",
        goal: state.monthlyGoal,
        done: state.monthDone,
        expected: monthExpected,
        hint: "acumulado do mês",
      },
    ];
  }, [state]);

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-black/40 text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando metas da loja...
      </div>
    );
  }

  if (!state || state.monthlyGoal <= 0) {
    return (
      <p className="text-xs text-black/40 py-2">
        Nenhuma meta mensal de faturamento definida para esta loja. Configure a meta em Metas do PDV.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {cards.map((c) => {
        const pct = c.goal > 0 ? (c.done / c.goal) * 100 : 0;
        const missing = Math.max(0, c.goal - c.done);
        const reached = missing <= 0;
        const Icon = c.icon;
        const isOpen = expanded.has(c.key);

        // Diferença vs. ritmo esperado (adiantado/atrasado).
        const paceDiff = c.done - c.expected;
        const ahead = paceDiff >= 0;

        return (
          <div
            key={c.key}
            className="relative p-4 rounded-2xl overflow-hidden border border-black/[0.04]"
            style={{ background: "var(--gradient-pos-silver)", boxShadow: "var(--shadow-pos-card), var(--shadow-pos-inset)" }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-black/55">
                <Icon className="h-3.5 w-3.5" />
                <span>{c.label}</span>
              </div>
              <span className={`text-xs font-bold ${reached ? "text-emerald-600" : pct >= 75 ? "text-orange-600" : pct >= 50 ? "text-yellow-600" : "text-red-500"}`}>
                {pct.toFixed(0)}%
              </span>
            </div>

            {/* Quanto já fizemos */}
            <p className="text-2xl font-bold tracking-tight text-black/85">{BRL(c.done)}</p>
            <p className="text-[10px] text-black/45 uppercase tracking-wider font-medium mt-0.5">
              Feito · Meta {BRL(c.goal)}
            </p>

            {/* Barra de progresso */}
            <div className="mt-2 h-2 rounded-full bg-black/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full ${reached ? "bg-emerald-500" : "bg-orange-500"}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>

            {/* DESTAQUE: quanto falta pra bater a meta */}
            <div className={`mt-3 rounded-xl px-3 py-2.5 ${reached ? "bg-emerald-500/10" : "bg-red-500/[0.07]"}`}>
              {reached ? (
                <p className="text-sm font-extrabold text-emerald-600">✅ Meta atingida</p>
              ) : (
                <>
                  <p className="text-[9px] uppercase tracking-wider font-semibold text-black/45">Falta pra bater a meta</p>
                  <p className="text-xl font-extrabold tracking-tight text-red-500 leading-tight">{BRL(missing)}</p>
                </>
              )}
            </div>

            {/* Ritmo esperado até agora */}
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-wider font-semibold text-black/40">Deveríamos ter</p>
                <p className="text-sm font-bold text-black/70">{BRL(c.expected)}</p>
              </div>
              <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg ${ahead ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
                {ahead ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                <span>{ahead ? "+" : "−"}{BRL(Math.abs(paceDiff)).replace("R$ ", "")}</span>
              </div>
            </div>

            <div className="flex items-center justify-between mt-2">
              <span className="text-[9px] text-black/35">{c.hint}</span>
              <button
                onClick={() => toggle(c.key)}
                className="flex items-center gap-1 text-[11px] font-semibold text-orange-600 hover:text-orange-700 transition-colors"
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Metas escalonadas
              </button>
            </div>

            {/* Metas escalonadas 80/90/100/110/120% */}
            {isOpen && (
              <div className="mt-2 pt-2 border-t border-black/10">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-black/45 uppercase tracking-wide">
                      <th className="text-left py-1 pr-2 font-semibold">Meta</th>
                      <th className="text-right py-1 px-1 font-semibold">Alvo</th>
                      <th className="text-right py-1 pl-2 font-semibold">Falta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TIER_PERCENTS.map((p) => {
                      const target = c.goal * (p / 100);
                      const tierReached = c.done >= target;
                      const tierMissing = Math.max(0, target - c.done);
                      return (
                        <tr key={p} className={`border-t border-black/5 ${tierReached ? "bg-emerald-500/10" : ""}`}>
                          <td className="py-1 pr-2">
                            <span className="inline-flex items-center gap-1.5">
                              {tierReached ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <Circle className="h-3.5 w-3.5 text-black/30" />
                              )}
                              <span className="font-semibold text-black/80">{p}%</span>
                              {p === 100 && <span className="text-[9px] text-black/40">(base)</span>}
                            </span>
                          </td>
                          <td className="text-right py-1 px-1 text-black/75">{BRL(target)}</td>
                          <td className={`text-right py-1 pl-2 font-semibold ${tierReached ? "text-emerald-600" : "text-red-500"}`}>
                            {tierReached ? "atingida" : BRL(tierMissing)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-black/10">
                      <td colSpan={3} className="py-1 text-black/45">
                        Feito: <span className="font-semibold text-emerald-600">{BRL(c.done)}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
