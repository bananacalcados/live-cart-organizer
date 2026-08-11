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
}

export interface SoldItem {
  sale_id: string;
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

  for (const slice of chunked(keys)) {
    const [bySkuRes, byBarcodeRes] = await Promise.all([
      supabase.from("pos_products").select("sku, barcode, cost_price, parent_sku, color, size, name").in("sku", slice),
      supabase.from("pos_products").select("sku, barcode, cost_price, parent_sku, color, size, name").in("barcode", slice),
    ]);
    for (const p of bySkuRes.data || []) upsert(p.sku, p);
    for (const p of byBarcodeRes.data || []) {
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
  let unattributedRevenue = 0;
  for (const s of sales) {
    const net = Number(s.total || 0) - Number(s.shipping_cost || 0);
    netBySale.set(s.id, net);
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
    const revenue = gross > 0
      ? (unitPrice * qty) * (net / gross)
      : totalQty > 0
        ? net * (qty / totalQty)
        : 0;

    const p = it.sku ? productIndex.get(String(it.sku)) : undefined;
    const unitCost = Number(p?.cost || 0);
    const cost = unitCost * qty;
    costBySale.set(it.sale_id, (costBySale.get(it.sale_id) || 0) + cost);

    return {
      sale_id: it.sale_id,
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
    const { data } = await supabase.from("pos_products").select("sku, name, color, size").in("sku", slice);
    for (const p of data || []) {
      if (p.sku && p.name) map.set(p.sku, { name: p.name, color: p.color ?? null, size: p.size ?? null });
    }
  }
  return map;
}
