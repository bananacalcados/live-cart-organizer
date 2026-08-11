import { supabase } from "@/integrations/supabase/client";

/**
 * FONTE ÚNICA de itens vendidos + custo.
 * Usada pelo Dashboard Geral (KPIs de custo/itens) e pelo modal de
 * Produtos Vendidos, garantindo valores IDÊNTICOS nos dois lugares.
 */

export interface SoldSaleRef {
  id: string;
  total: number;
  shipping_cost: number;
  /** loja da venda (para filtro de loja no modal) */
  store_id?: string | null;
  /** tipo da venda (physical | online | live | exchange) — vira canal */
  sale_type?: string | null;
}

export type SoldChannel = "physical" | "online" | "live" | "other";

export const CHANNEL_LABEL: Record<SoldChannel, string> = {
  physical: "Loja física",
  online: "Online",
  live: "Live",
  other: "Outros",
};

export function toChannel(saleType?: string | null): SoldChannel {
  const s = (saleType || "").toLowerCase();
  if (s === "physical" || s === "fisica" || s === "loja") return "physical";
  if (s === "online" || s === "site") return "online";
  if (s === "live") return "live";
  return "other";
}

export interface SoldItem {
  sale_id: string;
  /** loja e canal da venda de origem (para filtros no modal) */
  store_id: string | null;
  channel: SoldChannel;
  /** frete cobrado do cliente na venda de origem, rateado por item */
  shipping_share: number;
  sku: string | null;
  product_name: string | null;
  variant_name: string | null;
  size: string | null;
  quantity: number;
  unit_price: number;
  /** custo unitário resolvido (pos_products por sku ou barcode) */
  unit_cost: number;
  /** custo total = unit_cost * quantity */
  cost: number;
  /** faturamento rateado do item (total pago da venda − frete) */
  revenue: number;
  /** dados do cadastro (quando encontrado) */
  product?: {
    name: string | null;
    color: string | null;
    size: string | null;
    parent_sku: string | null;
  };
}

export interface SoldProductsData {
  items: SoldItem[];
  /** custo total por venda */
  costBySale: Map<string, number>;
  /** quantidade total de itens por venda */
  qtyBySale: Map<string, number>;
  /** faturamento de produtos (total − frete) que não pôde ser atribuído a itens */
  unattributedRevenue: number;
}

const CHUNK = 150;
const PAGE = 1000;

/** Busca TODAS as linhas (pagina de 1000 em 1000) — evita perder cadastros por causa do teto do PostgREST. */
async function fetchAllPages(build: () => any) {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function chunked<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Resolve custo por chave (sku ou barcode). Prioriza o maior custo cadastrado > 0. */
async function loadProductIndex(keys: string[]) {
  const bySku = new Map<string, { cost: number; name: string | null; color: string | null; size: string | null; parent_sku: string | null }>();
  if (keys.length === 0) return bySku;

  const upsert = (key: string | null, p: any) => {
    if (!key) return;
    const cost = Number(p.cost_price || 0);
    const prev = bySku.get(key);
    if (!prev) {
      bySku.set(key, { cost, name: p.name ?? null, color: p.color ?? null, size: p.size ?? null, parent_sku: p.parent_sku ?? null });
      return;
    }
    // mantém o maior custo > 0 e completa metadados faltantes
    if (cost > prev.cost) prev.cost = cost;
    prev.name = prev.name || (p.name ?? null);
    prev.color = prev.color || (p.color ?? null);
    prev.size = prev.size || (p.size ?? null);
    prev.parent_sku = prev.parent_sku || (p.parent_sku ?? null);
  };

  const cols = "sku, barcode, cost_price, parent_sku, color, size, name";
  for (const slice of chunked(keys)) {
    const [bySkuRows, byBarcodeRows] = await Promise.all([
      fetchAllPages(() => supabase.from("pos_products").select(cols).in("sku", slice)),
      fetchAllPages(() => supabase.from("pos_products").select(cols).in("barcode", slice)),
    ]);
    for (const p of bySkuRows) upsert(p.sku, p);
    for (const p of byBarcodeRows) {
      // indexa pelo barcode (a chave usada no item de venda) e também pelo sku
      upsert((p as any).barcode, p);
      upsert(p.sku, p);
    }
  }
  return bySku;
}

export async function fetchSoldProductsData(sales: SoldSaleRef[]): Promise<SoldProductsData> {
  const empty: SoldProductsData = { items: [], costBySale: new Map(), qtyBySale: new Map(), unattributedRevenue: 0 };
  const saleIds = sales.map((s) => s.id);
  if (saleIds.length === 0) return empty;

  const rawItems: any[] = [];
  for (const slice of chunked(saleIds)) {
    const { data, error } = await supabase
      .from("pos_sale_items")
      .select("sale_id, sku, product_name, variant_name, size, quantity, unit_price")
      .in("sale_id", slice);
    if (error) throw error;
    rawItems.push(...(data || []));
  }

  const keys = Array.from(new Set(rawItems.map((i) => i.sku).filter(Boolean))) as string[];
  const productIndex = await loadProductIndex(keys);

  // Rateio: faturamento de produtos da venda (total − frete) distribuído entre os itens.
  const grossBySale = new Map<string, number>();
  const qtyBySale = new Map<string, number>();
  for (const it of rawItems) {
    const q = Number(it.quantity || 0);
    grossBySale.set(it.sale_id, (grossBySale.get(it.sale_id) || 0) + Number(it.unit_price || 0) * q);
    qtyBySale.set(it.sale_id, (qtyBySale.get(it.sale_id) || 0) + q);
  }

  const netBySale = new Map<string, number>();
  const saleById = new Map<string, SoldSaleRef>();
  let unattributedRevenue = 0;
  for (const s of sales) {
    const net = Number(s.total || 0) - Number(s.shipping_cost || 0);
    netBySale.set(s.id, net);
    saleById.set(s.id, s);
    const hasItems = (qtyBySale.get(s.id) || 0) > 0;
    if (!hasItems) unattributedRevenue += net;
  }

  const costBySale = new Map<string, number>();
  const items: SoldItem[] = rawItems.map((it) => {
    const qty = Number(it.quantity || 0);
    const unitPrice = Number(it.unit_price || 0);
    const net = netBySale.get(it.sale_id) ?? 0;
    const gross = grossBySale.get(it.sale_id) || 0;
    const totalQty = qtyBySale.get(it.sale_id) || 0;
    // rateio por valor; se a venda não tem unit_price, rateia por quantidade
    const share = gross > 0
      ? (unitPrice * qty) / gross
      : totalQty > 0
        ? qty / totalQty
        : 0;
    const revenue = net * share;

    const sale = saleById.get(it.sale_id);
    const shippingShare = Number(sale?.shipping_cost || 0) * share;

    const p = it.sku ? productIndex.get(String(it.sku)) : undefined;
    const unitCost = Number(p?.cost || 0);
    const cost = unitCost * qty;
    costBySale.set(it.sale_id, (costBySale.get(it.sale_id) || 0) + cost);

    return {
      sale_id: it.sale_id,
      store_id: sale?.store_id ?? null,
      channel: toChannel(sale?.sale_type),
      shipping_share: shippingShare,
      sku: it.sku ?? null,
      product_name: it.product_name ?? null,
      variant_name: it.variant_name ?? null,
      size: it.size ?? null,
      quantity: qty,
      unit_price: unitPrice,
      unit_cost: unitCost,
      cost,
      revenue,
      product: p
        ? { name: p.name, color: p.color, size: p.size, parent_sku: p.parent_sku }
        : undefined,
    };
  });

  return { items, costBySale, qtyBySale, unattributedRevenue };
}

/** Busca nomes reais dos produtos pai (para agrupamento por pai no modal). */
export async function fetchParentNames(parentSkus: string[]) {
  const map = new Map<string, { name: string; color: string | null; size: string | null }>();
  if (parentSkus.length === 0) return map;
  for (const slice of chunked(parentSkus)) {
    const rows = await fetchAllPages(() => supabase.from("pos_products").select("sku, name, color, size").in("sku", slice));
    for (const p of rows) {
      if (p.sku && p.name) map.set(p.sku, { name: p.name, color: p.color ?? null, size: p.size ?? null });
    }
  }
  return map;
}
