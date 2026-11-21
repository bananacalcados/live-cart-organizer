// Regra ÚNICA do saldo enviado à Shopify (usada por shopify-mirror-stock e
// sync-master-product-stock). Saldo = soma de pos_products.stock por barcode
// SOMENTE nas lojas ativas e não-simulação; negativos entram na soma e o total
// final é limitado a 0. Barcode sem linha nas lojas consideradas => 0.
// Somente LEITURA: nunca grava em pos_products.

export type PosStockRow = { barcode?: string | null; store_id?: string | null; stock?: number | string | null };

export function sumSharedStock(rows: PosStockRow[], realStoreIds: string[]): number {
  if (!realStoreIds.length) return 0;
  const allowed = new Set(realStoreIds.map(String));
  let total = 0;
  for (const r of rows || []) {
    if (r.store_id != null && !allowed.has(String(r.store_id))) continue;
    total += Number(r.stock) || 0;
  }
  return total < 0 ? 0 : total;
}

/** Agrupa por barcode e diz quais barcodes não têm nenhuma linha nas lojas consideradas. */
export function sharedStockByBarcode(rows: PosStockRow[], realStoreIds: string[], barcodes: string[]) {
  const allowed = new Set(realStoreIds.map(String));
  const grouped = new Map<string, PosStockRow[]>();
  for (const r of rows || []) {
    if (!r.barcode || !allowed.has(String(r.store_id))) continue;
    const k = String(r.barcode);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(r);
  }
  const stock: Record<string, number> = {};
  const missing: string[] = [];
  for (const b of barcodes) {
    const list = grouped.get(String(b));
    if (!list || !list.length) { stock[b] = 0; missing.push(b); continue; }
    stock[b] = sumSharedStock(list, realStoreIds);
  }
  return { stock, missing };
}

// deno-lint-ignore no-explicit-any
export async function loadRealStoreIds(supabase: any): Promise<string[]> {
  const { data } = await supabase
    .from("pos_stores")
    .select("id")
    .eq("is_active", true)
    .eq("is_simulation", false);
  // deno-lint-ignore no-explicit-any
  return (data || []).map((s: any) => s.id);
}
