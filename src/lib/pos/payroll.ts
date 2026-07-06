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

export interface PersonRow {
  personId: string;
  name: string;
  channels: Record<ChannelKey, number>;
  total: number;
  goal: number;
  achievementPct: number; // 0-100+
  commissionPct: number; // % aplicado
  commissionValue: number;
  stores: StoreKey[]; // lojas onde teve venda direta (para detectar multi-loja)
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

interface ComputeInput {
  sales: PayrollSale[];
  sellers: PayrollSeller[];
  stores: PayrollStore[];
  people: PayrollPerson[];
  peopleSellers: { person_id: string; seller_id: string }[];
  liveParticipants: { person_id: string; store_id: string }[];
  scale: PayrollScaleRow[];
  goals: PayrollGoal[];
}

export function computePayroll(input: ComputeInput): PayrollResult {
  const { sales, sellers, stores, people, peopleSellers, liveParticipants, scale, goals } = input;

  const storeKeyById = new Map<string, StoreKey>();
  for (const s of stores) storeKeyById.set(s.id, storeKeyFromName(s.name));

  const sellerById = new Map<string, PayrollSeller>();
  for (const s of sellers) sellerById.set(s.id, s);

  const personBySeller = new Map<string, string>();
  for (const ps of peopleSellers) personBySeller.set(ps.seller_id, ps.person_id);

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
      stores: [],
    });
  }

  const liveNetByStoreKey = new Map<StoreKey, { net: number; storeId: string }>();
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
      // Live sem vendedora real (virtual) → mantém o rateio por participantes.
      const prev = liveNetByStoreKey.get(sKey) || { net: 0, storeId: sale.store_id || "" };
      prev.net += net;
      if (sale.store_id) prev.storeId = sale.store_id;
      liveNetByStoreKey.set(sKey, prev);
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

  const liveTotalNet = Array.from(liveNetByStoreKey.values()).reduce((a, b) => a + b.net, 0);

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

  const liveByStore: LiveStoreSummary[] = [];
  for (const [sKey, info] of liveNetByStoreKey) {
    if (sKey === "other") continue;
    const participants = participantsByStore.get(sKey) || [];
    const quota = participants.length > 0 ? info.net / participants.length : 0;
    liveByStore.push({ storeKey: sKey, storeId: info.storeId, net: info.net, participants: participants.length, quota });
    if (quota > 0) {
      const chan = (`live_${sKey}`) as ChannelKey;
      for (const personId of participants) {
        const row = rows.get(personId);
        if (row && CHANNEL_KEYS.includes(chan)) row.channels[chan] += quota;
      }
    }
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
  }

  return {
    people: Array.from(rows.values()).sort((a, b) => b.total - a.total),
    liveByStore,
    liveTotalNet,
    unmappedSellers: Array.from(unmappedMap.values()).sort((a, b) => b.net - a.net),
  };
}
