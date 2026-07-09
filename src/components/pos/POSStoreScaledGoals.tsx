import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, Trophy, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ScaledGoalTiers } from "./ScaledGoalTiers";
import {
  computePayroll, type PayrollScaleRow, type PayrollSale, type PayrollSeller,
  type PayrollStore, type PayrollPerson,
} from "@/lib/pos/payroll";

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const REVENUE_STATUSES = ["completed", "pending_sync", "paid"];

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
 */
export function POSStoreScaledGoals({ storeId, periodStart, periodEnd, periodLabel }: Props) {
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

  const startDate = format(periodStart, "yyyy-MM-dd");
  const endDate = format(periodEnd, "yyyy-MM-dd");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const startIso = periodStart.toISOString();
      const endIso = periodEnd.toISOString();
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
  }, [periodStart, periodEnd, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const result = useMemo(() => computePayroll({
    sales, sellers, stores, people, peopleSellers, liveParticipants, scale, goals,
  }), [sales, sellers, stores, people, peopleSellers, liveParticipants, scale, goals]);

  // Pessoas que possuem algum registro de vendedora nesta loja.
  const storePeople = useMemo(() => {
    const storeSellerIds = new Set(sellers.filter((s) => s.store_id === storeId).map((s) => s.id));
    const personIds = new Set(
      peopleSellers.filter((ps) => storeSellerIds.has(ps.seller_id)).map((ps) => ps.person_id)
    );
    return result.people.filter((p) => personIds.has(p.personId) && p.goal > 0);
  }, [result.people, peopleSellers, sellers, storeId]);

  const toggleExpanded = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-black/40 text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando metas escalonadas...
      </div>
    );
  }

  if (storePeople.length === 0) {
    return (
      <p className="text-xs text-black/40 py-2">
        Nenhuma vendedora com meta definida para esta loja no período. Configure metas e vínculos na aba Folha do Dashboard Geral.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {storePeople.map((p) => {
        const isOpen = expanded.has(p.personId);
        const t100 = p.tiers.find((t) => t.achievementPercent === 100);
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
                  <span className="block text-[9px] uppercase text-black/40">Meta 100%</span>
                  <span className="text-sm font-semibold text-black/70">{BRL(p.goal)}</span>
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
              <div className="px-3 pb-3 pt-1 border-t border-black/5">
                <ScaledGoalTiers goal={p.goal} total={p.total} tiers={p.tiers} variant="light" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
