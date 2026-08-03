import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Lock, Loader2, RefreshCw, Users, Settings, Download, Plus, Trophy, Radio, ChevronRight, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScaledGoalTiers } from "./ScaledGoalTiers";
import { PayrollLiveEventsDialog, type LiveEventInfo } from "./PayrollLiveEventsDialog";
import {
  computePayroll, CHANNEL_KEYS, CHANNEL_LABELS, storeKeyFromName,
  type PayrollScaleRow, type StoreKey,
} from "@/lib/pos/payroll";

const FOLHA_PASSWORD = "joey102030";
const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const REVENUE_STATUSES = ["completed", "pending_sync", "paid"];

interface Props {
  periodRange: { start: Date; end: Date; label: string };
}

interface Person {
  id: string; name: string; is_active: boolean; receives_all_lives: boolean; manual_goal_value: number | null;
  base_salary: number | null; role_bonus_percent: number | null;
  role_title: string | null; is_employee_only: boolean | null;
  provision_13: boolean | null; provision_vacation: boolean | null; provision_notice: boolean | null;
  provision_charges_percent: number | null;
}
interface PeriodEntry {
  person_id: string; overtime_hours: number | null; overtime_value: number | null; benefits_bonus: number | null;
}

interface Seller { id: string; name: string; store_id: string | null; }
interface Store { id: string; name: string; }

export function POSPayrollTab({ periodRange }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const [stores, setStores] = useState<Store[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleSellers, setPeopleSellers] = useState<{ person_id: string; seller_id: string }[]>([]);
  const [liveParticipants, setLiveParticipants] = useState<{ person_id: string; store_id: string }[]>([]);
  const [scale, setScale] = useState<PayrollScaleRow[]>([]);
  const [goals, setGoals] = useState<{ seller_id: string | null; goal_value: number | null }[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [eventOptOuts, setEventOptOuts] = useState<{ person_id: string; event_id: string }[]>([]);
  const [eventInfo, setEventInfo] = useState<Record<string, LiveEventInfo>>({});
  const [liveDialogPerson, setLiveDialogPerson] = useState<string | null>(null);
  const [periodEntries, setPeriodEntries] = useState<PeriodEntry[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeeRole, setNewEmployeeRole] = useState("");


  const startDate = format(periodRange.start, "yyyy-MM-dd");
  const endDate = format(periodRange.end, "yyyy-MM-dd");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const startIso = periodRange.start.toISOString();
      const endIso = periodRange.end.toISOString();
      const [storesRes, sellersRes, peopleRes, psRes, lpRes, scaleRes, goalsRes, salesRes, optOutRes, entriesRes] = await Promise.all([
        supabase.from("pos_stores").select("id, name").eq("is_active", true).eq("is_simulation", false).order("name"),
        supabase.from("pos_sellers").select("id, name, store_id").eq("is_active", true),
        supabase.from("pos_commission_people").select("id, name, is_active, receives_all_lives, manual_goal_value, base_salary, role_bonus_percent, role_title, is_employee_only, provision_13, provision_vacation, provision_notice, provision_charges_percent"),
        supabase.from("pos_commission_people_sellers").select("person_id, seller_id"),
        supabase.from("pos_commission_live_participants").select("person_id, store_id, period_start, period_end"),
        supabase.from("pos_commission_scale").select("achievement_percent, commission_percent"),
        supabase.from("pos_goals").select("seller_id, goal_value, period, period_start, period_end")
          .eq("is_active", true).eq("goal_type", "seller_revenue").not("seller_id", "is", null),
        supabase.from("pos_sales")
          .select("id, store_id, seller_id, sale_type, total, shipping_cost, payment_details, event_id")
          .in("status", REVENUE_STATUSES)
          .neq("revenue_attribution", "site_pickup_only")
          .or(`and(paid_at.gte.${startIso},paid_at.lte.${endIso}),and(paid_at.is.null,created_at.gte.${startIso},created_at.lte.${endIso})`)
          .limit(20000),
        supabase.from("pos_commission_live_event_optouts").select("person_id, event_id"),
        supabase.from("pos_payroll_period_entries")
          .select("person_id, overtime_hours, overtime_value, benefits_bonus")
          .eq("period_start", format(periodRange.start, "yyyy-MM-dd"))
          .eq("period_end", format(periodRange.end, "yyyy-MM-dd")),
      ]);
      setPeriodEntries((entriesRes.data || []) as PeriodEntry[]);


      setStores(storesRes.data || []);
      setSellers((sellersRes.data || []) as Seller[]);
      setPeople((peopleRes.data || []) as Person[]);
      setPeopleSellers((psRes.data || []) as any);
      // filtra participantes que se sobrepõem ao período
      const lp = (lpRes.data || []).filter((r: any) =>
        r.period_start <= endDate && r.period_end >= startDate
      ).map((r: any) => ({ person_id: r.person_id, store_id: r.store_id }));
      setLiveParticipants(lp);
      setScale((scaleRes.data || []) as PayrollScaleRow[]);
      // metas seller_revenue que cobrem o período
      const g = (goalsRes.data || []).filter((r: any) => {
        if (r.period === "monthly") return true;
        if (r.period_start && r.period_end) return r.period_start <= endDate && r.period_end >= startDate;
        return false;
      }).map((r: any) => ({ seller_id: r.seller_id, goal_value: r.goal_value }));
      setGoals(g);
      const salesRows = salesRes.data || [];
      setSales(salesRows);
      setEventOptOuts((optOutRes.data || []) as any);

      const eventIds = Array.from(new Set(salesRows.map((r: any) => r.event_id).filter(Boolean)));
      if (eventIds.length > 0) {
        const { data: evs } = await supabase.from("events").select("id, name, start_date").in("id", eventIds as string[]);
        const map: Record<string, LiveEventInfo> = {};
        for (const ev of evs || []) map[(ev as any).id] = { name: (ev as any).name, date: (ev as any).start_date };
        setEventInfo(map);
      } else {
        setEventInfo({});
      }
    } catch (e: any) {
      toast.error("Erro ao carregar folha: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [periodRange, startDate, endDate]);

  useEffect(() => { if (unlocked) load(); }, [unlocked, load]);

  const result = useMemo(() => computePayroll({
    sales, sellers, stores, people, peopleSellers, liveParticipants, scale, goals, eventOptOuts, periodEntries,
  }), [sales, sellers, stores, people, peopleSellers, liveParticipants, scale, goals, eventOptOuts, periodEntries]);

  const totals = useMemo(() => result.people.reduce(
    (acc, p) => ({
      commission: acc.commission + p.commissionValue,
      salary: acc.salary + p.baseSalary,
      bonus: acc.bonus + p.roleBonusValue,
      payout: acc.payout + p.totalPayout,
      overtime: acc.overtime + p.overtimeValue,
      gross: acc.gross + p.grossSalary,
      salCom: acc.salCom + p.salaryPlusCommission,
      provision: acc.provision + p.provisionTotal,
      withProvision: acc.withProvision + p.withProvision,
      benefits: acc.benefits + p.benefitsBonus,
      totalCost: acc.totalCost + p.totalCost,
    }),
    {
      commission: 0, salary: 0, bonus: 0, payout: 0, overtime: 0, gross: 0,
      salCom: 0, provision: 0, withProvision: 0, benefits: 0, totalCost: 0,
    },
  ), [result.people]);


  const dialogPerson = useMemo(
    () => result.people.find((p) => p.personId === liveDialogPerson) || null,
    [result.people, liveDialogPerson],
  );

  const storesByKey = useMemo(() => {
    const m = new Map<StoreKey, Store>();
    for (const s of stores) {
      const k = storeKeyFromName(s.name);
      if ((k === "perola" || k === "centro") && !m.has(k)) m.set(k, s);
    }
    return m;
  }, [stores]);

  // ---- Config actions ----
  const mapSellerToPerson = async (sellerId: string, personId: string) => {
    setSaving(true);
    try {
      if (personId === "__none__") {
        await supabase.from("pos_commission_people_sellers").delete().eq("seller_id", sellerId);
      } else {
        await supabase.from("pos_commission_people_sellers")
          .upsert({ seller_id: sellerId, person_id: personId }, { onConflict: "seller_id" });
      }
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const createPersonFromSeller = async (seller: Seller) => {
    setSaving(true);
    try {
      const clean = seller.name.replace(/\b(f[ií]sic[oa]|onl?ine|loja)\b/gi, "").trim() || seller.name;
      const { data, error } = await supabase.from("pos_commission_people")
        .insert({ name: clean }).select("id").single();
      if (error) throw error;
      await supabase.from("pos_commission_people_sellers")
        .upsert({ seller_id: seller.id, person_id: data.id }, { onConflict: "seller_id" });
      toast.success(`Vendedora "${clean}" criada`);
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const toggleHybrid = async (personId: string, value: boolean) => {
    setSaving(true);
    try {
      await supabase.from("pos_commission_people").update({ receives_all_lives: value }).eq("id", personId);
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const setManualGoal = async (personId: string, value: number | null) => {
    setSaving(true);
    try {
      await supabase.from("pos_commission_people").update({ manual_goal_value: value }).eq("id", personId);
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  /** Salário fixo / gratificação de cargo — permanentes na ficha da vendedora. */
  const setSalaryField = async (
    personId: string,
    field: "base_salary" | "role_bonus_percent",
    value: number,
  ) => {
    setSaving(true);
    try {
      const { error } = await supabase.from("pos_commission_people")
        .update({ [field]: value } as any).eq("id", personId);
      if (error) throw error;
      setPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, [field]: value } : p)));
      toast.success("Salário atualizado");
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  /** Cria funcionário administrativo (sem vínculo com vendedora). */
  const createEmployee = async () => {
    const name = newEmployeeName.trim();
    if (!name) { toast.error("Informe o nome do funcionário"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("pos_commission_people")
        .insert({ name, role_title: newEmployeeRole.trim() || null, is_employee_only: true } as any);
      if (error) throw error;
      setNewEmployeeName(""); setNewEmployeeRole("");
      toast.success(`Funcionário "${name}" criado`);
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  /** Campos permanentes da ficha (cargo, provisionamentos, encargos). */
  const setPersonField = async (personId: string, field: string, value: any) => {
    setSaving(true);
    try {
      const { error } = await supabase.from("pos_commission_people")
        .update({ [field]: value } as any).eq("id", personId);
      if (error) throw error;
      setPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, [field]: value } as Person : p)));
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  /** Lançamentos do período: horas extras e bônus de benefícios. */
  const setPeriodField = async (
    personId: string,
    field: "overtime_hours" | "overtime_value" | "benefits_bonus",
    value: number,
  ) => {
    setSaving(true);
    try {
      const current = periodEntries.find((e) => e.person_id === personId);
      const payload = {
        person_id: personId,
        period_start: startDate,
        period_end: endDate,
        overtime_hours: current?.overtime_hours ?? 0,
        overtime_value: current?.overtime_value ?? 0,
        benefits_bonus: current?.benefits_bonus ?? 0,
        [field]: value,
      };
      const { error } = await supabase.from("pos_payroll_period_entries")
        .upsert(payload as any, { onConflict: "person_id,period_start,period_end" });
      if (error) throw error;
      setPeriodEntries((prev) => {
        const exists = prev.some((e) => e.person_id === personId);
        if (exists) return prev.map((e) => (e.person_id === personId ? { ...e, [field]: value } : e));
        return [...prev, {
          person_id: personId,
          overtime_hours: payload.overtime_hours,
          overtime_value: payload.overtime_value,
          benefits_bonus: payload.benefits_bonus,
        } as PeriodEntry];
      });
      toast.success("Lançamento salvo");
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };




  const toggleLiveParticipant = async (personId: string, storeId: string, checked: boolean) => {
    setSaving(true);
    try {
      if (checked) {
        await supabase.from("pos_commission_live_participants").upsert(
          { person_id: personId, store_id: storeId, period_start: startDate, period_end: endDate },
          { onConflict: "person_id,store_id,period_start,period_end" }
        );
      } else {
        await supabase.from("pos_commission_live_participants").delete()
          .eq("person_id", personId).eq("store_id", storeId)
          .eq("period_start", startDate).eq("period_end", endDate);
      }
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const updateScaleRow = async (achievement: number, commission: number) => {
    setSaving(true);
    try {
      await supabase.from("pos_commission_scale")
        .upsert({ achievement_percent: achievement, commission_percent: commission }, { onConflict: "achievement_percent" });
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const exportCsv = () => {
    const header = [
      "Pessoa", "Cargo", ...CHANNEL_KEYS.map((k) => CHANNEL_LABELS[k]),
      "Faturamento", "Meta", "% Atingido", "% Comissão", "Comissão R$",
      "Salário fixo", "% Cargo", "Gratificação R$",
      "Horas extras (qtd)", "Horas extras R$", "Salário bruto",
      "Salário + Comissão",
      "Provisão 13º", "Provisão Férias", "Provisão 1/3", "Provisão Aviso prévio", "Encargos provisão", "Provisão total",
      "Com provisionamento", "Bônus benefícios", "Custo total",
    ];
    const lines = result.people.map((p) => [
      p.name, p.roleTitle,
      ...CHANNEL_KEYS.map((k) => p.channels[k].toFixed(2)),
      p.total.toFixed(2), p.goal.toFixed(2), p.achievementPct.toFixed(1), p.commissionPct.toFixed(2), p.commissionValue.toFixed(2),
      p.baseSalary.toFixed(2), p.roleBonusPercent.toFixed(2), p.roleBonusValue.toFixed(2),
      p.overtimeHours.toFixed(2), p.overtimeValue.toFixed(2), p.grossSalary.toFixed(2),
      p.salaryPlusCommission.toFixed(2),
      p.provision13.toFixed(2), p.provisionVacation.toFixed(2), p.provisionVacationBonus.toFixed(2),
      p.provisionNotice.toFixed(2), p.provisionCharges.toFixed(2), p.provisionTotal.toFixed(2),
      p.withProvision.toFixed(2), p.benefitsBonus.toFixed(2), p.totalCost.toFixed(2),
    ].join(";"));

    const csv = [header.join(";"), ...lines].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `folha_${startDate}_${endDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Gate ----
  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="p-4 rounded-2xl bg-zinc-800 border border-zinc-700">
          <Lock className="h-8 w-8 text-orange-400" />
        </div>
        <h3 className="text-lg font-bold text-zinc-100">Folha protegida</h3>
        <p className="text-sm text-zinc-400">Digite a senha para acessar o comissionamento</p>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw === FOLHA_PASSWORD) { setUnlocked(true); setPw(""); }
            else toast.error("Senha incorreta");
          }}
        >
          <Input
            type="password" value={pw} onChange={(e) => setPw(e.target.value)}
            placeholder="Senha" autoFocus
            className="w-56 bg-zinc-800 border-zinc-700 text-zinc-100"
          />
          <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white">Entrar</Button>
        </form>
      </div>
    );
  }

  const mappedSellerIds = new Set(peopleSellers.map((p) => p.seller_id));

  return (
    <div className="p-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-orange-400" /> Folha de Comissionamento — {periodRange.label}
          </h3>
          <p className="text-[11px] text-zinc-500">Recebido sem frete · lives divididas · escala por meta</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowConfig((v) => !v)} className="gap-2 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700">
            <Settings className="h-3.5 w-3.5" /> {showConfig ? "Fechar config" : "Configurar"}
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} className="gap-2 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700">
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" onClick={load} disabled={loading} className="gap-2 bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando folha...
        </div>
      ) : (
        <>
          {/* Live pool summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {result.liveByStore.map((l) => (
              <div key={l.storeKey} className="bg-zinc-800/70 border border-zinc-700 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-400 font-semibold">
                  <Radio className="h-3.5 w-3.5 text-fuchsia-400" /> Live {l.storeKey === "perola" ? "Pérola" : "Centro"}
                </div>
                <p className="text-lg font-bold text-zinc-100">{BRL(l.net)}</p>
                <p className="text-[11px] text-zinc-400">
                  {l.participants > 0 ? `${l.participants} vendedora(s) · cota ${BRL(l.quota)}` : "Sem participantes selecionadas"}
                </p>
              </div>
            ))}
            <div className="bg-zinc-800/70 border border-zinc-700 rounded-lg p-3">
              <div className="text-[11px] uppercase tracking-wide text-zinc-400 font-semibold">Total lives (recebido s/ frete)</div>
              <p className="text-lg font-bold text-emerald-400">{BRL(result.liveTotalNet)}</p>
              <p className="text-[11px] text-zinc-400">somado às híbridas por completo</p>
            </div>
          </div>

          {/* Config panel */}
          {showConfig && (
            <div className="space-y-4 border border-zinc-700 rounded-lg p-4 bg-zinc-900/60">
              {/* Seller ↔ person links (editable) */}
              <div>
                <h4 className="text-sm font-semibold text-zinc-200 mb-2">Vincular registros de vendedor às pessoas</h4>
                {people.filter((p) => p.is_active).length === 0 && sellers.length > 0 && (
                  <p className="text-[11px] text-amber-400/90 mb-2">
                    Nenhuma pessoa cadastrada ainda. Comece clicando em <strong>"+ Criar pessoa"</strong> ao lado de cada vendedora. Depois, use <strong>"Escolher pessoa"</strong> para juntar os outros registros da mesma pessoa.
                  </p>
                )}
                {sellers.length === 0 ? (
                  <p className="text-[12px] text-zinc-500">Nenhum registro de vendedor ativo.</p>
                ) : (
                  <div className="space-y-1.5">
                    {[...sellers]
                      .sort((a, b) => {
                        // não vinculados primeiro, depois por nome
                        const am = mappedSellerIds.has(a.id) ? 1 : 0;
                        const bm = mappedSellerIds.has(b.id) ? 1 : 0;
                        if (am !== bm) return am - bm;
                        return a.name.localeCompare(b.name);
                      })
                      .map((s) => {
                        const store = stores.find((st) => st.id === s.store_id);
                        const activePeople = people.filter((p) => p.is_active);
                        const currentPersonId = peopleSellers.find((ps) => ps.seller_id === s.id)?.person_id;
                        return (
                          <div key={s.id} className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12px] text-zinc-300 w-48 truncate">
                              {s.name} <span className="text-zinc-500">· {store?.name || "—"}</span>
                            </span>
                            <Select
                              value={currentPersonId ?? "__none__"}
                              onValueChange={(v) => mapSellerToPerson(s.id, v)}
                            >
                              <SelectTrigger className="w-52 h-8 bg-zinc-800 border-zinc-700 text-zinc-200 text-xs">
                                <SelectValue placeholder={activePeople.length === 0 ? "Nenhuma pessoa — crie primeiro" : "Escolher pessoa"} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">
                                  <span className="text-zinc-400">Sem vínculo</span>
                                </SelectItem>
                                {activePeople.length === 0 ? (
                                  <div className="px-2 py-1.5 text-xs text-zinc-500">Crie uma pessoa primeiro →</div>
                                ) : (
                                  activePeople.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            {currentPersonId ? (
                              <Badge variant="outline" className="h-8 flex items-center border-emerald-700 text-emerald-400 text-[10px]">
                                vinculado
                              </Badge>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => createPersonFromSeller(s)} disabled={saving}
                                className="h-8 gap-1 bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700 text-xs">
                                <Plus className="h-3 w-3" /> Criar pessoa
                              </Button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Novo funcionário (não vendedor) */}
              <div className="border-t border-zinc-800 pt-3">
                <h4 className="text-sm font-semibold text-zinc-200 mb-2">Novo funcionário (não vendedor)</h4>
                <div className="flex items-end gap-2 flex-wrap">
                  <div>
                    <Label className="text-[11px] text-zinc-400">Nome</Label>
                    <Input value={newEmployeeName} onChange={(e) => setNewEmployeeName(e.target.value)}
                      placeholder="Ex.: Maria (financeiro)"
                      className="w-56 h-8 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs" />
                  </div>
                  <div>
                    <Label className="text-[11px] text-zinc-400">Cargo</Label>
                    <Input value={newEmployeeRole} onChange={(e) => setNewEmployeeRole(e.target.value)}
                      placeholder="Ex.: Auxiliar administrativo"
                      className="w-56 h-8 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs" />
                  </div>
                  <Button size="sm" onClick={createEmployee} disabled={saving}
                    className="h-8 gap-1 bg-orange-500 hover:bg-orange-600 text-white text-xs">
                    <Plus className="h-3 w-3" /> Adicionar funcionário
                  </Button>
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  Entra na folha com salário, gratificação, provisionamento, horas extras e bônus — sem comissão.
                </p>
              </div>




              {/* People config */}
              {people.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-zinc-200 mb-2">Pessoas · salário fixo · gratificação de cargo · híbrida · meta manual · divisão de live</h4>
                  <div className="space-y-2">
                    {people.filter((p) => p.is_active).map((p) => {
                      const linked = peopleSellers.filter((ps) => ps.person_id === p.id)
                        .map((ps) => sellers.find((s) => s.id === ps.seller_id)?.name).filter(Boolean);
                      return (
                        <div key={p.id} className="border border-zinc-800 rounded p-2 bg-zinc-800/40 space-y-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-[13px] font-medium text-zinc-100 w-32 truncate">{p.name}</span>
                            <span className="text-[10px] text-zinc-500 flex-1 truncate">{linked.join(", ") || "sem registros"}</span>
                            <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                              <Switch checked={p.receives_all_lives} onCheckedChange={(v) => toggleHybrid(p.id, v)} />
                              Recebe TODAS as lives (híbrida)
                            </label>
                            <div className="flex items-center gap-1">
                              <Label className="text-[11px] text-zinc-400">Meta manual</Label>
                              <Input
                                type="number" defaultValue={p.manual_goal_value ?? ""} placeholder="auto"
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value);
                                  if (v !== (p.manual_goal_value ?? null)) setManualGoal(p.id, v);
                                }}
                                className="w-24 h-7 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-4 flex-wrap pl-1">
                            <div className="flex items-center gap-1">
                              <Label className="text-[11px] text-zinc-400">Salário fixo R$</Label>
                              <Input
                                type="number" step="0.01" defaultValue={p.base_salary ?? ""} placeholder="0,00"
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? 0 : Number(e.target.value);
                                  if (v !== Number(p.base_salary || 0)) setSalaryField(p.id, "base_salary", v);
                                }}
                                className="w-28 h-7 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <Label className="text-[11px] text-zinc-400">Gratificação cargo %</Label>
                              <Input
                                type="number" step="0.01" defaultValue={p.role_bonus_percent ?? ""} placeholder="0"
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? 0 : Number(e.target.value);
                                  if (v !== Number(p.role_bonus_percent || 0)) setSalaryField(p.id, "role_bonus_percent", v);
                                }}
                                className="w-20 h-7 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
                              />
                              <span className="text-[10px] text-zinc-500">
                                = {BRL(Number(p.base_salary || 0) * (Number(p.role_bonus_percent || 0) / 100))}
                              </span>
                            </div>
                          </div>
                          {/* Provisionamento CLT (1/12 por mês) */}
                          <div className="flex items-center gap-4 flex-wrap pl-1">
                            <span className="text-[10px] uppercase text-zinc-500">Provisionamento CLT:</span>
                            <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                              <Checkbox checked={p.provision_13 !== false}
                                onCheckedChange={(v) => setPersonField(p.id, "provision_13", !!v)} />
                              13º
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                              <Checkbox checked={p.provision_vacation !== false}
                                onCheckedChange={(v) => setPersonField(p.id, "provision_vacation", !!v)} />
                              Férias + 1/3
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                              <Checkbox checked={p.provision_notice !== false}
                                onCheckedChange={(v) => setPersonField(p.id, "provision_notice", !!v)} />
                              Aviso prévio
                            </label>
                            <div className="flex items-center gap-1">
                              <Label className="text-[11px] text-zinc-400">Encargos %</Label>
                              <Input
                                type="number" step="0.01" defaultValue={p.provision_charges_percent ?? ""} placeholder="0"
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? 0 : Number(e.target.value);
                                  if (v !== Number(p.provision_charges_percent || 0)) setPersonField(p.id, "provision_charges_percent", v);
                                }}
                                className="w-20 h-7 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <Label className="text-[11px] text-zinc-400">Cargo</Label>
                              <Input
                                defaultValue={p.role_title ?? ""} placeholder="ex.: Gerente"
                                onBlur={(e) => {
                                  const v = e.target.value.trim() || null;
                                  if (v !== (p.role_title ?? null)) setPersonField(p.id, "role_title", v);
                                }}
                                className="w-32 h-7 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
                              />
                            </div>
                          </div>
                          {/* Lançamentos do período */}
                          <div className="flex items-center gap-4 flex-wrap pl-1">
                            <span className="text-[10px] uppercase text-zinc-500">Período {periodRange.label}:</span>
                            <div className="flex items-center gap-1">
                              <Label className="text-[11px] text-zinc-400">Horas extras (qtd)</Label>
                              <Input
                                key={`oh-${p.id}-${startDate}`}
                                type="number" step="0.5"
                                defaultValue={periodEntries.find((e) => e.person_id === p.id)?.overtime_hours ?? ""}
                                placeholder="0"
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? 0 : Number(e.target.value);
                                  const cur = Number(periodEntries.find((x) => x.person_id === p.id)?.overtime_hours || 0);
                                  if (v !== cur) setPeriodField(p.id, "overtime_hours", v);
                                }}
                                className="w-20 h-7 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <Label className="text-[11px] text-zinc-400">Horas extras R$</Label>
                              <Input
                                key={`ov-${p.id}-${startDate}`}
                                type="number" step="0.01"
                                defaultValue={periodEntries.find((e) => e.person_id === p.id)?.overtime_value ?? ""}
                                placeholder="0,00"
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? 0 : Number(e.target.value);
                                  const cur = Number(periodEntries.find((x) => x.person_id === p.id)?.overtime_value || 0);
                                  if (v !== cur) setPeriodField(p.id, "overtime_value", v);
                                }}
                                className="w-24 h-7 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <Label className="text-[11px] text-zinc-400">Bônus cartão benefícios R$</Label>
                              <Input
                                key={`bb-${p.id}-${startDate}`}
                                type="number" step="0.01"
                                defaultValue={periodEntries.find((e) => e.person_id === p.id)?.benefits_bonus ?? ""}
                                placeholder="0,00"
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? 0 : Number(e.target.value);
                                  const cur = Number(periodEntries.find((x) => x.person_id === p.id)?.benefits_bonus || 0);
                                  if (v !== cur) setPeriodField(p.id, "benefits_bonus", v);
                                }}
                                className="w-24 h-7 bg-zinc-800 border-zinc-700 text-zinc-100 text-xs"
                              />
                              <span className="text-[10px] text-zinc-500">não tributável</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 flex-wrap pl-1">
                            <span className="text-[10px] uppercase text-zinc-500">Divide live:</span>
                            {(["perola", "centro"] as StoreKey[]).map((k) => {
                              const store = storesByKey.get(k);
                              if (!store) return null;
                              const checked = liveParticipants.some((lp) => lp.person_id === p.id && lp.store_id === store.id);
                              return (
                                <label key={k} className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                                  <Checkbox checked={checked} onCheckedChange={(v) => toggleLiveParticipant(p.id, store.id, !!v)} />
                                  {k === "perola" ? "Pérola" : "Centro"}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Scale */}
              <div>
                <h4 className="text-sm font-semibold text-zinc-200 mb-2">Escala de comissão (atingimento da meta → %)</h4>
                <div className="flex flex-wrap gap-2">
                  {[...scale].sort((a, b) => a.achievement_percent - b.achievement_percent).map((row) => (
                    <div key={row.achievement_percent} className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1">
                      <span className="text-[11px] text-zinc-400">{row.achievement_percent}% →</span>
                      <Input
                        type="number" step="0.1" defaultValue={row.commission_percent}
                        onBlur={(e) => { const v = Number(e.target.value); if (v !== row.commission_percent) updateScaleRow(row.achievement_percent, v); }}
                        className="w-16 h-7 bg-zinc-900 border-zinc-700 text-zinc-100 text-xs"
                      />
                      <span className="text-[11px] text-zinc-400">%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Results table */}
          <div className="border border-zinc-700 rounded-lg overflow-hidden">
            <ScrollArea className="w-full">
              <table className="w-full text-[12px]">
                <thead className="bg-zinc-800 text-zinc-300">
                  <tr>
                    <th className="text-left p-2 font-semibold sticky left-0 bg-zinc-800">Pessoa</th>
                    {CHANNEL_KEYS.map((k) => (
                      <th key={k} className="text-right p-2 font-medium whitespace-nowrap">{CHANNEL_LABELS[k]}</th>
                    ))}
                    <th className="text-right p-2 font-semibold">Faturamento</th>
                    <th className="text-right p-2 font-semibold">Meta</th>
                    <th className="text-right p-2 font-semibold">% Meta</th>
                    <th className="text-right p-2 font-semibold">% Com.</th>
                    <th className="text-right p-2 font-semibold">Comissão</th>
                    <th className="text-right p-2 font-semibold">Salário</th>
                    <th className="text-right p-2 font-semibold whitespace-nowrap">Gratificação</th>
                    <th className="text-right p-2 font-semibold whitespace-nowrap">H. extras</th>
                    <th className="text-right p-2 font-semibold whitespace-nowrap">Bruto s/ provisão</th>
                    <th className="text-right p-2 font-semibold whitespace-nowrap">Salário + Comissão</th>
                    <th className="text-right p-2 font-semibold whitespace-nowrap">Provisão</th>
                    <th className="text-right p-2 font-semibold text-sky-300 whitespace-nowrap">Com provisão</th>
                    <th className="text-right p-2 font-semibold whitespace-nowrap">Bônus benefícios</th>
                    <th className="text-right p-2 font-semibold text-emerald-300 whitespace-nowrap">Custo total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.people.map((p) => {
                    const isOpen = expanded.has(p.personId);
                    return (
                    <Fragment key={p.personId}>
                    <tr
                      key={p.personId}
                      className="border-t border-zinc-800 hover:bg-zinc-800/40 cursor-pointer"
                      onClick={() => p.goal > 0 && toggleExpanded(p.personId)}
                    >
                      <td className="p-2 text-zinc-100 sticky left-0 bg-zinc-900">
                        <span className="inline-flex items-center gap-1">
                          {p.goal > 0 ? (
                            isOpen ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                          ) : <span className="w-3.5 inline-block" />}
                          {p.name}
                        </span>
                        {p.stores.length > 1 && (
                          <Badge variant="outline" className="ml-1 text-[9px] border-amber-600 text-amber-400">2 lojas</Badge>
                        )}
                        {p.isEmployeeOnly && (
                          <Badge variant="outline" className="ml-1 text-[9px] border-sky-700 text-sky-300">Administrativo</Badge>
                        )}
                        {p.roleTitle && (
                          <span className="block text-[9px] text-zinc-500">{p.roleTitle}</span>
                        )}
                      </td>
                      {CHANNEL_KEYS.map((k) => {
                        const isLiveQuota = k === "live_perola" || k === "live_centro";
                        const clickable = isLiveQuota && p.liveEvents.length > 0;
                        return (
                          <td
                            key={k}
                            className={`p-2 text-right ${clickable ? "text-fuchsia-300 underline decoration-dotted cursor-pointer hover:text-fuchsia-200" : "text-zinc-400"}`}
                            title={clickable ? "Ver eventos que incidiram nesse valor" : undefined}
                            onClick={clickable ? (e) => { e.stopPropagation(); setLiveDialogPerson(p.personId); } : undefined}
                          >
                            {p.channels[k] ? BRL(p.channels[k]) : "—"}
                          </td>
                        );
                      })}
                      <td className="p-2 text-right font-bold text-emerald-400">{BRL(p.total)}</td>
                      <td className="p-2 text-right text-zinc-300">{p.goal > 0 ? BRL(p.goal) : "—"}</td>
                      <td className="p-2 text-right text-zinc-300">{p.goal > 0 ? `${p.achievementPct.toFixed(0)}%` : "s/ meta"}</td>
                      <td className="p-2 text-right text-zinc-300">
                        {p.goal > 0 ? (
                          <>
                            {p.commissionPct.toLocaleString("pt-BR", { minimumFractionDigits: 1 })}%
                            <span className="block text-[9px] text-zinc-500">100% = {(p.tiers.find((t) => t.achievementPercent === 100)?.commissionPercent ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1 })}%</span>
                          </>
                        ) : "—"}
                      </td>
                      <td className="p-2 text-right font-bold text-orange-400">{BRL(p.commissionValue)}</td>
                      <td className="p-2 text-right text-zinc-300">{p.baseSalary ? BRL(p.baseSalary) : "—"}</td>
                      <td className="p-2 text-right text-zinc-300">
                        {p.roleBonusValue ? (
                          <>
                            {BRL(p.roleBonusValue)}
                            <span className="block text-[9px] text-zinc-500">{p.roleBonusPercent.toLocaleString("pt-BR")}%</span>
                          </>
                        ) : "—"}
                      </td>
                      <td className="p-2 text-right text-zinc-300">
                        {p.overtimeValue || p.overtimeHours ? (
                          <>
                            {BRL(p.overtimeValue)}
                            <span className="block text-[9px] text-zinc-500">{p.overtimeHours.toLocaleString("pt-BR")}h</span>
                          </>
                        ) : "—"}
                      </td>
                      <td className="p-2 text-right text-zinc-200">{BRL(p.grossSalary)}</td>
                      <td className="p-2 text-right text-zinc-100 font-semibold">{BRL(p.salaryPlusCommission)}</td>
                      <td
                        className="p-2 text-right text-amber-300"
                        title={`13º ${BRL(p.provision13)} · Férias ${BRL(p.provisionVacation)} · 1/3 ${BRL(p.provisionVacationBonus)} · Aviso prévio ${BRL(p.provisionNotice)}${p.provisionCharges ? ` · Encargos ${BRL(p.provisionCharges)}` : ""}`}
                      >
                        {p.provisionTotal ? BRL(p.provisionTotal) : "—"}
                      </td>
                      <td className="p-2 text-right font-bold text-sky-300">{BRL(p.withProvision)}</td>
                      <td className="p-2 text-right text-zinc-300">{p.benefitsBonus ? BRL(p.benefitsBonus) : "—"}</td>
                      <td className="p-2 text-right font-bold text-emerald-300">{BRL(p.totalCost)}</td>
                    </tr>
                    {isOpen && p.goal > 0 && (
                      <tr key={p.personId + "-tiers"} className="bg-zinc-900/60">
                        <td colSpan={CHANNEL_KEYS.length + 15} className="p-3">
                          <div className="text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mb-1.5">
                            Metas escalonadas — {p.name}
                          </div>
                          <ScaledGoalTiers goal={p.goal} total={p.total} tiers={p.tiers} variant="dark" />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                  {result.people.length === 0 && (
                    <tr><td colSpan={CHANNEL_KEYS.length + 15} className="p-6 text-center text-zinc-500">Cadastre as pessoas em "Configurar"</td></tr>
                  )}
                </tbody>
                {result.people.length > 0 && (
                  <tfoot className="bg-zinc-800/80 text-zinc-200 font-semibold">
                    <tr>
                      <td className="p-2 sticky left-0 bg-zinc-800/80">TOTAL</td>
                      <td colSpan={CHANNEL_KEYS.length + 4} />
                      <td className="p-2 text-right text-orange-400">{BRL(totals.commission)}</td>
                      <td className="p-2 text-right">{BRL(totals.salary)}</td>
                      <td className="p-2 text-right">{BRL(totals.bonus)}</td>
                      <td className="p-2 text-right">{BRL(totals.overtime)}</td>
                      <td className="p-2 text-right">{BRL(totals.gross)}</td>
                      <td className="p-2 text-right">{BRL(totals.salCom)}</td>
                      <td className="p-2 text-right text-amber-300">{BRL(totals.provision)}</td>
                      <td className="p-2 text-right text-sky-300">{BRL(totals.withProvision)}</td>
                      <td className="p-2 text-right">{BRL(totals.benefits)}</td>
                      <td className="p-2 text-right text-emerald-300">{BRL(totals.totalCost)}</td>
                    </tr>
                  </tfoot>
                )}

              </table>
            </ScrollArea>
          </div>

          {result.unmappedSellers.length > 0 && (
            <p className="text-[11px] text-amber-400">
              ⚠ {result.unmappedSellers.length} registro(s) de vendedor com vendas ainda não vinculados a uma pessoa
              ({BRL(result.unmappedSellers.reduce((a, b) => a + b.net, 0))} fora do cálculo). Use "Configurar".
            </p>
          )}
        </>
      )}

      {dialogPerson && (
        <PayrollLiveEventsDialog
          open={!!liveDialogPerson}
          onOpenChange={(v) => !v && setLiveDialogPerson(null)}
          personId={dialogPerson.personId}
          personName={dialogPerson.name}
          events={dialogPerson.liveEvents}
          eventInfo={eventInfo}
          onChanged={load}
        />
      )}
    </div>
  );
}
