import { isNewStockLabelCode, resolveStockLabelCode, type ResolvedStockCode } from "@/lib/inventoryStockCode";

export type PosNewCodeResult =
  | { kind: "not_new_code" }
  | { kind: "not_found" }
  | { kind: "no_store_product"; code: string; resolved: ResolvedStockCode }
  | { kind: "found"; lookup: string; resolved: ResolvedStockCode };

/** Resolve o código novo da etiqueta; devolve o EAN/SKU do cadastro da loja para reaproveitar a busca atual. */
export async function resolvePosNewCode(code: string, storeId: string): Promise<PosNewCodeResult> {
  const trimmed = code.trim();
  if (!isNewStockLabelCode(trimmed)) return { kind: "not_new_code" };
  const resolved = await resolveStockLabelCode(trimmed, storeId);
  if (!resolved) return { kind: "not_found" };
  const lookup = resolved.product_barcode || resolved.product_sku;
  if (!resolved.pos_product_id || !lookup) return { kind: "no_store_product", code: resolved.code || trimmed, resolved };
  return { kind: "found", lookup, resolved };
}

export function findSaleItemIndexForResolvedCode<T extends { sku?: string | null; barcode?: string | null; scanned?: boolean }>(
  items: T[],
  resolved: ResolvedStockCode,
): number {
  const codes = [resolved.product_barcode, resolved.product_sku, resolved.variant_gtin, resolved.variant_sku]
    .filter((c): c is string => !!c && !!c.trim())
    .map((c) => c.trim().toLowerCase());
  return items.findIndex((i) =>
    !i.scanned && codes.some((c) => (i.sku || "").trim().toLowerCase() === c || (i.barcode || "").trim().toLowerCase() === c)
  );
}
