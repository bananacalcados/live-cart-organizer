import type { ResolvedStockCode } from "@/lib/inventoryStockCode";

export interface StockLabelMatchItem {
  sku?: string | null;
  barcode?: string | null;
  barcodes?: readonly (string | null)[];
}

const normalizeCode = (value: string | null | undefined) => String(value || "").trim().toLowerCase();

/** EAN/SKU que uma etiqueta nova representa, sem vazios nem duplicados. */
export function resolvedStockLabelCodes(resolved: ResolvedStockCode): string[] {
  return [...new Set([
    resolved.product_barcode,
    resolved.product_sku,
    resolved.variant_gtin,
    resolved.variant_sku,
  ].map(normalizeCode).filter(Boolean))];
}

export function itemMatchesResolvedStockLabel(item: StockLabelMatchItem, resolved: ResolvedStockCode): boolean {
  const itemCodes = [item.sku, item.barcode, ...(item.barcodes || [])].map(normalizeCode).filter(Boolean);
  const resolvedCodes = resolvedStockLabelCodes(resolved);
  return itemCodes.some((code) => resolvedCodes.includes(code));
}
