import { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ScaledGoalTiers } from "./ScaledGoalTiers";
import { countBusinessDays, getBrazilianHolidays } from "@/lib/businessDays";
import {
  computePayroll, buildGoalTiers, commissionPctForAchievement,
  CHANNEL_KEYS, CHANNEL_LABELS,
  type PayrollScaleRow, type PayrollSale, type PayrollSeller,
  type PayrollStore, type PayrollPerson, type ChannelKey,
} from "@/lib/pos/payroll";

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const REVENUE_STATUSES = ["completed", "pending_sync", "paid"];

type FilterMode = "day" | "month" | "period";

interface Props {
  storeId: string;
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
}

/**
 * Espelho do painel de METAS ESCALONADAS da aba FOLHA, dentro do dashboard de
 * cada loja, mostrando apenas as vendedoras que pertencem àquela loja.
 * Reutiliza o mesmo cálculo (computePayroll) — não cria lógica nova.
 *
 * Possui filtro próprio (Dia / Mês / Período) para não precisar mexer nas datas
 * de todo o dashboard. No modo DIA, a meta é a meta do mês dividida pelos dias
 * úteis (seg-sáb, sem feriados) do mês de referência.
 */
export function POSStoreScaledGoals({ storeId, periodStart, periodEnd, periodLabel }: Props) {
  const [mode, setMode] = useState<FilterMode>("period");
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<PayrollStore[]>([]);
  const [sellers, setSellers] = useState<PayrollSeller[]>([]);
  const [people, setPeople] = useState<PayrollPerson[]>([]);
  const [peopleSellers, setPeopleSellers] = useState<{ person_id: string; seller_id: string }[]>([]);
  const [liveParticipants, setLiveParticipants] = useState<{ person_id: string; store_id: string }[]>([]);
  const [scale, setScale] = useState<PayrollScaleRow[]>([]);
  const [goals, setGoals] = useState<{ seller_id: string | null; goal_value: number | null }[]>([]);
  const [sales, setSales] = useState<PayrollSale[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Faixa efetiva de acordo com o filtro interno do painel.
  const { effStart, effEnd, effLabel } = useMemo(() => {
    const now = new Date();
    if (mode === "day") {
      return { effStart: startOfDay(now), effEnd: endOfDay(now), effLabel: "Hoje" };
    }
    if (mode === "month") {
      return {
        effStart: startOfMonth(now),
        effEnd: endOfMonth(now),
        effLabel: format(now, "MM/yyyy"),
      };
    }
    return { effStart: periodStart, effEnd: periodEnd, effLabel: periodLabel };
  }, [mode, periodStart, periodEnd, periodLabel]);

  const startDate = format(effStart, "yyyy-MM-dd");
  const endDate = format(effEnd, "yyyy-MM-dd");

  // Dias úteis do mês de referência (para calcular a meta diária no modo DIA).
  const businessDaysInMonth = useMemo(() => {
    const ref = effStart;
    const first = startOfMonth(ref);
    const last = endOfMonth(ref);
    return countBusinessDays(first, last, getBrazilianHolidays(ref.getFullYear())) || 1;
  }, [effStart]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const startIso = effStart.toISOString();
      const endIso = effEnd.toISOString();
      const [storesRes, sellersRes, peopleRes, psRes, lpRes, scaleRes, goalsRes, salesRes] = await Promise.all([
        supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name"),
        supabase.from("pos_sellers").select("id, name, store_id").eq("is_active", true),
        supabase.from("pos_commission_people").select("id, name, is_active, receives_all_lives, manual_goal_value"),
        supabase.from("pos_commission_people_sellers").select("person_id, seller_id"),
        supabase.from("pos_commission_live_participants").select("person_id, store_id, period_start, period_end"),
        supabase.from("pos_commission_scale").select("achievement_percent, commission_percent"),
        supabase.from("pos_goals").select("seller_id, goal_value, period, period_start, period_end")
          .eq("is_active", true).eq("goal_type", "seller_revenue").not("seller_id", "is", null),
        supabase.from("pos_sales")
          .select("id, store_id, seller_id, sale_type, total, shipping_cost, payment_details")
          .eq("expedition_stage", "concluido")
          .in("status", REVENUE_STATUSES)
          .neq("revenue_attribution", "site_pickup_only")
          .or(`and(paid_at.gte.${startIso},paid_at.lte.${endIso}),and(paid_at.is.null,created_at.gte.${startIso},created_at.lte.${endIso})`)
          .limit(20000),
      ]);
      setStores((storesRes.data || []) as PayrollStore[]);
      setSellers((sellersRes.data || []) as PayrollSeller[]);
      setPeople((peopleRes.data || []) as PayrollPerson[]);
      setPeopleSellers((psRes.data || []) as any);
      const lp = (lpRes.data || []).filter((r: any) =>
        r.period_start <= endDate && r.period_end >= startDate
      ).map((r: any) => ({ person_id: r.person_id, store_id: r.store_id }));
      setLiveParticipants(lp);
      setScale((scaleRes.data || []) as PayrollScaleRow[]);
      const g = (goalsRes.data || []).filter((r: any) => {
        if (r.period === "monthly") return true;
        if (r.period_start && r.period_end) return r.period_start <= endDate && r.period_end >= startDate;
        return false;
      }).map((r: any) => ({ seller_id: r.seller_id, goal_value: r.goal_value }));
      setGoals(g);
      setSales((salesRes.data || []) as PayrollSale[]);
    } finally {
      setLoading(false);
    }
  }, [effStart, effEnd, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const result = useMemo(() => computePayroll({
    sales, sellers, stores, people, peopleSellers, liveParticipants, scale, goals,
  }), [sales, sellers, stores, people, peopleSellers, liveParticipants, scale, goals]);

  // Pessoas que possuem algum registro de vendedora nesta loja, já ajustadas ao
  // filtro interno: no modo DIA a meta (e degraus) usam a meta diária.
  const storePeople = useMemo(() => {
    const storeSellerIds = new Set(sellers.filter((s) => s.store_id === storeId).map((s) => s.id));
    const personIds = new Set(
      peopleSellers.filter((ps) => storeSellerIds.has(ps.seller_id)).map((ps) => ps.person_id)
    );
    return result.people
      .filter((p) => personIds.has(p.personId) && p.goal > 0)
      .map((p) => {
        const goal = mode === "day" ? p.goal / businessDaysInMonth : p.goal;
        const achievementPct = goal > 0 ? (p.total / goal) * 100 : 0;
        const commissionPct = goal > 0 ? commissionPctForAchievement(achievementPct, scale) : 0;
        return {
          ...p,
          goal,
          achievementPct,
          commissionPct,
          commissionValue: p.total * (commissionPct / 100),
          missing: Math.max(0, goal - p.total),
          tiers: buildGoalTiers(goal, p.total, scale),
        };
      });
  }, [result.people, peopleSellers, sellers, storeId, mode, businessDaysInMonth, scale]);

  const toggleExpanded = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const filterBtn = (m: FilterMode, label: string) => (
    <button
      key={m}
      onClick={() => setMode(m)}
      className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
        mode === m ? "bg-orange-500 text-white" : "bg-black/[0.05] text-black/50 hover:bg-black/10"
      }`}
    >
      {label}
    </button>
  );

  const metaLabel = mode === "day" ? "Meta do dia" : "Meta 100%";

  return (
    <div className="space-y-2">
      {/* Filtro interno do painel */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          {filterBtn("day", "Dia")}
          {filterBtn("month", "Mês")}
          {filterBtn("period", "Período")}
        </div>
        <span className="text-[11px] text-black/40">
          {effLabel}
          {mode === "day" && ` · meta ÷ ${businessDaysInMonth} dias úteis`}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-black/40 text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando metas escalonadas...
        </div>
      ) : storePeople.length === 0 ? (
        <p className="text-xs text-black/40 py-2">
          Nenhuma vendedora com meta definida para esta loja no período. Configure metas e vínculos na aba Folha do Dashboard Geral.
        </p>
      ) : (
        storePeople.map((p) => {
          const isOpen = expanded.has(p.personId);
          const t100 = p.tiers.find((t) => t.achievementPercent === 100);
          const activeChannels = CHANNEL_KEYS.filter((k) => p.channels[k] > 0);
          return (
            <div key={p.personId} className="rounded-xl border border-black/10 bg-white/70 overflow-hidden">
              <button
                onClick={() => toggleExpanded(p.personId)}
                className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-black/[0.03] transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-black/40" /> : <ChevronRight className="h-4 w-4 text-black/40" />}
                  <span className="font-medium text-sm text-black/80 truncate">{p.name}</span>
                </span>
                <span className="flex items-center gap-4 text-right shrink-0">
                  <span className="hidden sm:block">
                    <span className="block text-[9px] uppercase text-black/40">Faturamento</span>
                    <span className="text-sm font-bold text-emerald-600">{BRL(p.total)}</span>
                  </span>
                  <span className="hidden sm:block">
                    <span className="block text-[9px] uppercase text-black/40">{metaLabel}</span>
                    <span className="text-sm font-semibold text-black/70">{BRL(p.goal)}</span>
                  </span>
                  <span className="hidden md:block">
                    <span className="block text-[9px] uppercase text-black/40">Falta</span>
                    <span className={`text-sm font-semibold ${p.missing <= 0 ? "text-emerald-600" : "text-black/70"}`}>
                      {p.missing <= 0 ? "atingida" : BRL(p.missing)}
                    </span>
                  </span>
                  <span>
                    <span className="block text-[9px] uppercase text-black/40">% Meta</span>
                    <span className="text-sm font-bold text-black/80">{p.achievementPct.toFixed(0)}%</span>
                  </span>
                  <span>
                    <span className="block text-[9px] uppercase text-black/40">Comissão</span>
                    <span className="text-sm font-bold text-orange-600">{BRL(p.commissionValue)}</span>
                    <span className="block text-[9px] text-black/40">
                      {p.commissionPct.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}% · 100%={(t100?.commissionPercent ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1 })}%
                    </span>
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-black/5 space-y-3">
                  {/* Faturamento por canal */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-black/40 font-semibold mb-1.5">Faturamento por canal</p>
                    {activeChannels.length === 0 ? (
                      <p className="text-[11px] text-black/40">Sem vendas no período.</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {activeChannels.map((k) => (
                          <div key={k} className="rounded-lg bg-black/[0.03] px-2.5 py-1.5">
                            <span className="block text-[9px] uppercase text-black/40">{CHANNEL_LABELS[k as ChannelKey]}</span>
                            <span className="text-xs font-semibold text-black/70">{BRL(p.channels[k])}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Degraus da meta escalonada */}
                  <ScaledGoalTiers goal={p.goal} total={p.total} tiers={p.tiers} variant="light" />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
