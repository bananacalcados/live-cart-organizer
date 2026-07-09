import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarRange, CalendarClock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getBrazilianHolidays, countBusinessDays, parseLocalDate } from "@/lib/businessDays";

const BRL = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const REVENUE_STATUSES = ["completed", "pending_sync", "paid"];

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

/**
 * Painel de metas da LOJA no topo do dashboard, no mesmo padrão visual dos KPIs.
 * Mostra três metas — Dia, Semana e Mês — com o quanto já foi feito, quanto
 * falta e a porcentagem. As metas Dia/Semana derivam da meta MENSAL da loja:
 *   - Meta do dia  = meta mensal ÷ dias úteis do mês (seg-sáb, sem feriados)
 *   - Meta da semana = meta mensal ÷ nº de semanas do mês corrente
 */
export function POSStoreGoalCards({ storeId }: Props) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<StoreGoalState | null>(null);

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
        const bizDays = countBusinessDays(monthStart, new Date(now.getFullYear(), now.getMonth() + 1, 0), holidays) || 1;

        if (!cancelled) {
          setState({
            monthlyGoal,
            dayDone,
            weekDone,
            monthDone,
            businessDaysInMonth: bizDays,
            weeksInMonth: weeksInMonth(now) || 1,
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
    const weeklyGoal = state.monthlyGoal / state.weeksInMonth;
    return [
      {
        key: "day",
        icon: CalendarDays,
        label: "Meta do Dia",
        goal: dailyGoal,
        done: state.dayDone,
        hint: `meta mensal ÷ ${state.businessDaysInMonth} dias úteis`,
      },
      {
        key: "week",
        icon: CalendarRange,
        label: "Meta da Semana",
        goal: weeklyGoal,
        done: state.weekDone,
        hint: `meta mensal ÷ ${state.weeksInMonth} semanas`,
      },
      {
        key: "month",
        icon: CalendarClock,
        label: "Meta do Mês",
        goal: state.monthlyGoal,
        done: state.monthDone,
        hint: "acumulado do mês",
      },
    ];
  }, [state]);

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

            <div className="flex items-center justify-between mt-1.5">
              <span className={`text-[11px] font-semibold ${reached ? "text-emerald-600" : "text-black/70"}`}>
                {reached ? "✅ Meta atingida" : `Falta ${BRL(missing)}`}
              </span>
              <span className="text-[9px] text-black/35">{c.hint}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
