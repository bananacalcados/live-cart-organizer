// Cálculo de comissionamento das vendedoras (aba FOLHA do Dashboard Geral do PDV).
// Funções puras e testáveis: recebem os dados já buscados e devolvem o fechamento.
import { isVirtualSeller } from "@/lib/pos/virtualSellers";

export type StoreKey = "perola" | "centro" | "other";
export type SaleTypeKey = "fisica" | "online" | "live";

export interface PayrollSale {
  id: string;
  store_id: string | null;
  seller_id: string | null;
  sale_type: string | null;
  total: number | null;
  shipping_cost: number | null;
  payment_details: any;
  event_id?: string | null;
}

export interface PayrollSeller {
  id: string;
  name: string;
  store_id: string | null;
}

export interface PayrollStore {
  id: string;
  name: string;
}

export interface PayrollPerson {
  id: string;
  name: string;
  is_active: boolean;
  receives_all_lives: boolean;
  manual_goal_value: number | null;
  /** Salário fixo mensal (permanente, cadastrado na pessoa). */
  base_salary?: number | null;
  /** Gratificação de cargo de confiança em % sobre o salário fixo. */
  role_bonus_percent?: number | null;
  /** Cargo/função (livre). */
  role_title?: string | null;
  /** Funcionário administrativo (não vendedor). */
  is_employee_only?: boolean | null;
  /** Provisionamentos CLT ativos (1/12 ao mês). */
  provision_13?: boolean | null;
  provision_vacation?: boolean | null;
  provision_notice?: boolean | null;
  /** % de encargos aplicado sobre o provisionamento total. */
  provision_charges_percent?: number | null;
}

/** Lançamento manual do período (horas extras e bônus de benefícios). */
export interface PayrollPeriodEntry {
  person_id: string;
  overtime_hours?: number | null;
  overtime_value?: number | null;
  benefits_bonus?: number | null;
}


export interface PayrollScaleRow {
  achievement_percent: number;
  commission_percent: number;
}

export interface PayrollGoal {
  seller_id: string | null;
  goal_value: number | null;
}

/** Frete recebido em uma venda (coluna shipping_cost com fallback no payment_details). */
export function saleFreight(sale: PayrollSale): number {
  const col = Number(sale.shipping_cost || 0);
  if (col > 0) return col;
  const pd = sale.payment_details as any;
  return Number(pd?.shipping_amount || 0);
}

/** Valor recebido sem frete. */
export function saleNet(sale: PayrollSale): number {
  return Math.max(0, Number(sale.total || 0) - saleFreight(sale));
}

export function storeKeyFromName(name: string): StoreKey {
  const n = (name || "").toLowerCase();
  if (n.includes("perola") || n.includes("pérola")) return "perola";
  if (n.includes("centro")) return "centro";
  return "other";
}

export function saleTypeKey(sale: PayrollSale): SaleTypeKey {
  const t = (sale.sale_type || "").toLowerCase();
  if (t === "live") return "live";
  if (t === "online") return "online";
  return "fisica";
}

// Buckets de canal exibidos por vendedora.
export const CHANNEL_KEYS = [
  "fisica_perola",
  "fisica_centro",
  "online_perola",
  "online_centro",
  "live_perola",
  "live_centro",
  "live_all",
] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  fisica_perola: "Física Pérola",
  fisica_centro: "Física Centro",
  online_perola: "Online Pérola",
  online_centro: "Online Centro",
  live_perola: "Live Pérola (cota)",
  live_centro: "Live Centro (cota)",
  live_all: "Todas as Lives",
};

/** Meta escalonada de uma pessoa (um degrau da escala aplicado sobre a meta base 100%). */
export interface GoalTier {
  achievementPercent: number; // 80, 90, 100, 110, 120...
  targetRevenue: number;      // faturamento necessário = meta100 * achievementPercent/100
  commissionPercent: number;  // % de comissão nesse degrau
  reached: boolean;           // já atingiu esse degrau?
  missing: number;            // quanto falta para atingir (0 se já atingiu)
  commissionValue: number;    // comissão projetada AO atingir exatamente esse degrau
}

/** Detalhe de um evento/live que incidiu (ou não) no faturamento de live de uma pessoa. */
export interface LiveEventBreakdown {
  eventId: string | null;     // null = vendas de live sem evento vinculado
  storeKey: StoreKey;
  storeId: string;
  net: number;                // faturamento líquido do evento naquela loja
  participants: number;       // nº de participantes considerados no rateio
  quota: number;              // cota por participante
  included: boolean;          // a pessoa participou (true) ou foi desmarcada (false)
  credited: number;           // valor efetivamente creditado à pessoa (0 se desmarcada)
}

export interface PersonRow {
  personId: string;
  name: string;
  channels: Record<ChannelKey, number>;
  total: number;
  goal: number;
  achievementPct: number; // 0-100+
  commissionPct: number; // % aplicado
  commissionValue: number;
  baseSalary: number;        // salário fixo cadastrado
  roleBonusPercent: number;  // % de gratificação de cargo
  roleBonusValue: number;    // salário fixo * %
  totalPayout: number;       // salário + gratificação + comissão (compatibilidade)
  roleTitle: string;         // cargo/função
  isEmployeeOnly: boolean;   // funcionário administrativo (sem vendas)
  overtimeHours: number;     // qtd. de horas extras lançadas no período
  overtimeValue: number;     // R$ pago em horas extras no período
  benefitsBonus: number;     // bônus de cartão de benefícios (não tributável)
  provision13: number;           // 13º = base/12
  provisionVacation: number;     // férias = base/12
  provisionVacationBonus: number;// 1/3 constitucional = (base/12)/3
  provisionNotice: number;       // aviso prévio = base/12
  provisionCharges: number;      // encargos % sobre o provisionamento
  provisionTotal: number;        // soma dos provisionamentos ativos + encargos
  grossSalary: number;           // salário + gratificação + horas extras
  salaryPlusCommission: number;  // bruto + comissão
  withProvision: number;         // bruto + comissão + provisionamento
  totalCost: number;             // + bônus de benefícios

  tiers: GoalTier[]; // metas escalonadas (80/90/100/110/120) da escala
  stores: StoreKey[]; // lojas onde teve venda direta (para detectar multi-loja)
  liveEvents: LiveEventBreakdown[]; // eventos que incidem no rateio de live da pessoa
}

export interface LiveStoreSummary {
  storeKey: StoreKey;
  storeId: string;
  net: number;
  participants: number;
  quota: number;
}

export interface PayrollResult {
  people: PersonRow[];
  liveByStore: LiveStoreSummary[];
  liveTotalNet: number;
  unmappedSellers: { id: string; name: string; net: number }[];
}


/** Comissão % pela escala: maior degrau cujo achievement_percent <= atingimento. */
export function commissionPctForAchievement(achievementPct: number, scale: PayrollScaleRow[]): number {
  const sorted = [...scale].sort((a, b) => a.achievement_percent - b.achievement_percent);
  let pct = 0;
  for (const row of sorted) {
    if (achievementPct >= row.achievement_percent) pct = row.commission_percent;
  }
  return pct;
}

/**
 * Constrói as metas escalonadas (degraus da escala) para uma pessoa.
 * meta100 é o valor da meta (100%). Cada degrau vira um alvo de faturamento
 * (meta100 * degrau/100), com quanto falta e a comissão projetada ao atingi-lo.
 */
export function buildGoalTiers(meta100: number, total: number, scale: PayrollScaleRow[]): GoalTier[] {
  if (meta100 <= 0) return [];
  return [...scale]
    .sort((a, b) => a.achievement_percent - b.achievement_percent)
    .map((row) => {
      const targetRevenue = meta100 * (row.achievement_percent / 100);
      return {
        achievementPercent: row.achievement_percent,
        targetRevenue,
        commissionPercent: row.commission_percent,
        reached: total >= targetRevenue,
        missing: Math.max(0, targetRevenue - total),
        commissionValue: targetRevenue * (row.commission_percent / 100),
      };
    });
}

interface ComputeInput {
  sales: PayrollSale[];
  sellers: PayrollSeller[];
  stores: PayrollStore[];
  people: PayrollPerson[];
  peopleSellers: { person_id: string; seller_id: string }[];
  liveParticipants: { person_id: string; store_id: string }[];
  scale: PayrollScaleRow[];
  goals: PayrollGoal[];
  /** Eventos em que a pessoa NÃO participou (opt-out). Sem registro = participa. */
  eventOptOuts?: { person_id: string; event_id: string }[];
  /** Lançamentos manuais do período (horas extras, bônus de benefícios). */
  periodEntries?: PayrollPeriodEntry[];
}

export function computePayroll(input: ComputeInput): PayrollResult {
  const { sales, sellers, stores, people, peopleSellers, liveParticipants, scale, goals, eventOptOuts, periodEntries } = input;

  const storeKeyById = new Map<string, StoreKey>();
  for (const s of stores) storeKeyById.set(s.id, storeKeyFromName(s.name));

  const sellerById = new Map<string, PayrollSeller>();
  for (const s of sellers) sellerById.set(s.id, s);

  const personBySeller = new Map<string, string>();
  for (const ps of peopleSellers) personBySeller.set(ps.seller_id, ps.person_id);

  const entryByPerson = new Map<string, PayrollPeriodEntry>();
  for (const e of periodEntries || []) entryByPerson.set(e.person_id, e);

  // Metas por seller_id → soma por pessoa
  const goalBySeller = new Map<string, number>();
  for (const g of goals) {
    if (!g.seller_id) continue;
    goalBySeller.set(g.seller_id, (goalBySeller.get(g.seller_id) || 0) + Number(g.goal_value || 0));
  }

  // Inicializa linhas por pessoa
  const rows = new Map<string, PersonRow>();
  for (const p of people) {
    if (!p.is_active) continue;
    rows.set(p.id, {
      personId: p.id,
      name: p.name,
      channels: Object.fromEntries(CHANNEL_KEYS.map((k) => [k, 0])) as Record<ChannelKey, number>,
      total: 0,
      goal: 0,
      achievementPct: 0,
      commissionPct: 0,
      commissionValue: 0,
      baseSalary: 0,
      roleBonusPercent: 0,
      roleBonusValue: 0,
      totalPayout: 0,
      roleTitle: p.role_title || "",
      isEmployeeOnly: !!p.is_employee_only,
      overtimeHours: 0,
      overtimeValue: 0,
      benefitsBonus: 0,
      provision13: 0,
      provisionVacation: 0,
      provisionVacationBonus: 0,
      provisionNotice: 0,
      provisionCharges: 0,
      provisionTotal: 0,
      grossSalary: 0,
      salaryPlusCommission: 0,
      withProvision: 0,
      totalCost: 0,
      tiers: [],
      stores: [],
      liveEvents: [],
    });
  }


  // Pool de live agrupado por loja + evento
  const livePool = new Map<string, { storeKey: StoreKey; eventId: string | null; net: number; storeId: string }>();
  const optOutSet = new Set<string>();
  for (const o of eventOptOuts || []) optOutSet.add(`${o.person_id}::${o.event_id}`);
  const unmappedMap = new Map<string, { id: string; name: string; net: number }>();


  // 1) Vendas diretas (não-live) + acúmulo do pool de lives
  for (const sale of sales) {
    const net = saleNet(sale);
    if (net <= 0) continue;
    const sKey = sale.store_id ? storeKeyById.get(sale.store_id) || "other" : "other";
    const tKey = saleTypeKey(sale);

    if (tKey === "live") {
      // Live com vendedora REAL mapeada (evento multi-loja / envio manual):
      // credita direto à vendedora e NÃO entra no rateio, evitando dupla contagem.
      const liveSeller = sale.seller_id ? sellerById.get(sale.seller_id) : undefined;
      if (liveSeller && !isVirtualSeller(liveSeller.name)) {
        const personId = personBySeller.get(liveSeller.id);
        if (personId && rows.has(personId)) {
          const row = rows.get(personId)!;
          const chan = (`live_${sKey}`) as ChannelKey;
          if (CHANNEL_KEYS.includes(chan)) row.channels[chan] += net;
          if (sKey !== "other" && !row.stores.includes(sKey)) row.stores.push(sKey);
          continue;
        }
        // vendedora real mas não mapeada a uma pessoa → registra como não-mapeada
        const cur = unmappedMap.get(liveSeller.id) || { id: liveSeller.id, name: liveSeller.name, net: 0 };
        cur.net += net;
        unmappedMap.set(liveSeller.id, cur);
        continue;
      }
      // Live sem vendedora real (virtual) → rateio por participantes, agrupado por evento.
      const evId = sale.event_id || null;
      const poolKey = `${sKey}::${evId || "sem-evento"}`;
      const prev = livePool.get(poolKey) || { storeKey: sKey, eventId: evId, net: 0, storeId: sale.store_id || "" };
      prev.net += net;
      if (sale.store_id) prev.storeId = sale.store_id;
      livePool.set(poolKey, prev);
      continue;

    }

    const seller = sale.seller_id ? sellerById.get(sale.seller_id) : undefined;
    // Vendas de vendedor virtual (Loja/Live Shopping) não entram na atribuição pessoal.
    if (!seller || isVirtualSeller(seller.name)) continue;
    const personId = personBySeller.get(seller.id);
    if (!personId || !rows.has(personId)) {
      const cur = unmappedMap.get(seller.id) || { id: seller.id, name: seller.name, net: 0 };
      cur.net += net;
      unmappedMap.set(seller.id, cur);
      continue;
    }
    const row = rows.get(personId)!;
    const chan = (`${tKey}_${sKey}`) as ChannelKey;
    if (CHANNEL_KEYS.includes(chan)) row.channels[chan] += net;
    if (sKey !== "other" && !row.stores.includes(sKey)) row.stores.push(sKey);
  }

  const liveTotalNet = Array.from(livePool.values()).reduce((a, b) => a + b.net, 0);

  // 2) Participantes da divisão por loja
  const participantsByStore = new Map<StoreKey, string[]>();
  for (const lp of liveParticipants) {
    const sKey = storeKeyById.get(lp.store_id);
    if (!sKey) continue;
    if (!rows.has(lp.person_id)) continue;
    const list = participantsByStore.get(sKey) || [];
    if (!list.includes(lp.person_id)) list.push(lp.person_id);
    participantsByStore.set(sKey, list);
  }

  // Rateio POR EVENTO: cada live tem seu próprio conjunto de participantes,
  // descontando quem foi desmarcada (opt-out) daquele evento.
  const liveByStore: LiveStoreSummary[] = [];
  const netByStore = new Map<StoreKey, { net: number; storeId: string }>();

  for (const [key, info] of livePool) {
    const sKey = info.storeKey;
    if (sKey === "other") continue;
    const acc = netByStore.get(sKey) || { net: 0, storeId: info.storeId };
    acc.net += info.net;
    if (info.storeId) acc.storeId = info.storeId;
    netByStore.set(sKey, acc);

    const all = participantsByStore.get(sKey) || [];
    const eligible = info.eventId
      ? all.filter((pid) => !optOutSet.has(`${pid}::${info.eventId}`))
      : all;
    const quota = eligible.length > 0 ? info.net / eligible.length : 0;
    const chan = (`live_${sKey}`) as ChannelKey;

    for (const personId of all) {
      const row = rows.get(personId);
      if (!row) continue;
      const included = eligible.includes(personId);
      const credited = included ? quota : 0;
      if (credited > 0 && CHANNEL_KEYS.includes(chan)) row.channels[chan] += credited;
      row.liveEvents.push({
        eventId: info.eventId,
        storeKey: sKey,
        storeId: info.storeId,
        net: info.net,
        participants: eligible.length,
        quota,
        included,
        credited,
      });
    }
    void key;
  }

  for (const [sKey, acc] of netByStore) {
    const participants = participantsByStore.get(sKey) || [];
    liveByStore.push({
      storeKey: sKey,
      storeId: acc.storeId,
      net: acc.net,
      participants: participants.length,
      quota: participants.length > 0 ? acc.net / participants.length : 0,
    });
  }


  // 3) Híbridas: total de todas as lives
  for (const p of people) {
    if (!p.is_active || !p.receives_all_lives) continue;
    const row = rows.get(p.id);
    if (row) row.channels.live_all += liveTotalNet;
  }

  // 4) Total, meta, atingimento, comissão
  const goalByPerson = new Map<string, number>();
  for (const ps of peopleSellers) {
    const g = goalBySeller.get(ps.seller_id) || 0;
    goalByPerson.set(ps.person_id, (goalByPerson.get(ps.person_id) || 0) + g);
  }

  for (const p of people) {
    const row = rows.get(p.id);
    if (!row) continue;
    row.total = CHANNEL_KEYS.reduce((a, k) => a + row.channels[k], 0);
    const manual = Number(p.manual_goal_value || 0);
    row.goal = manual > 0 ? manual : (goalByPerson.get(p.id) || 0);
    row.achievementPct = row.goal > 0 ? (row.total / row.goal) * 100 : 0;
    row.commissionPct = row.goal > 0 ? commissionPctForAchievement(row.achievementPct, scale) : 0;
    row.commissionValue = row.total * (row.commissionPct / 100);
    row.baseSalary = Math.max(0, Number(p.base_salary || 0));
    row.roleBonusPercent = Math.max(0, Number(p.role_bonus_percent || 0));
    row.roleBonusValue = row.baseSalary * (row.roleBonusPercent / 100);
    row.totalPayout = row.baseSalary + row.roleBonusValue + row.commissionValue;

    // Lançamentos do período
    const entry = entryByPerson.get(p.id);
    row.overtimeHours = Math.max(0, Number(entry?.overtime_hours || 0));
    row.overtimeValue = Math.max(0, Number(entry?.overtime_value || 0));
    row.benefitsBonus = Math.max(0, Number(entry?.benefits_bonus || 0));

    // Provisionamento CLT (1/12 ao mês sobre a base salarial)
    const base = row.baseSalary + row.roleBonusValue;
    const twelfth = base / 12;
    row.provision13 = p.provision_13 === false ? 0 : twelfth;
    row.provisionVacation = p.provision_vacation === false ? 0 : twelfth;
    row.provisionVacationBonus = p.provision_vacation === false ? 0 : twelfth / 3;
    row.provisionNotice = p.provision_notice === false ? 0 : twelfth;
    const provisionSubtotal =
      row.provision13 + row.provisionVacation + row.provisionVacationBonus + row.provisionNotice;
    row.provisionCharges = provisionSubtotal * (Math.max(0, Number(p.provision_charges_percent || 0)) / 100);
    row.provisionTotal = provisionSubtotal + row.provisionCharges;

    // Camadas de custo
    row.grossSalary = row.baseSalary + row.roleBonusValue + row.overtimeValue;
    row.salaryPlusCommission = row.grossSalary + row.commissionValue;
    row.withProvision = row.salaryPlusCommission + row.provisionTotal;
    row.totalCost = row.withProvision + row.benefitsBonus;

    row.tiers = buildGoalTiers(row.goal, row.total, scale);

  }

  return {
    people: Array.from(rows.values()).sort((a, b) => b.total - a.total),
    liveByStore,
    liveTotalNet,
    unmappedSellers: Array.from(unmappedMap.values()).sort((a, b) => b.net - a.net),
  };
}
