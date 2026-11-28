import { isNewStockLabelCode, resolveStockLabelCode, type ResolvedStockCode } from "@/lib/inventoryStockCode";
import { itemMatchesResolvedStockLabel } from "@/lib/stockLabelMatch";
import type { ExpItem } from "./expedition";

/** Shared recognition: direct legacy barcode first, optional SKU, then the existing internal-label resolver. */
export async function matchExpeditionScan(items: ExpItem[], raw: string, available: (item: ExpItem) => boolean, storeId: string | null, allowSku = false, resolver = resolveStockLabelCode) {
  const code = raw.replace(/\s/g, "");
  const direct = (item: ExpItem) => item.barcode === code || (allowSku && item.sku === code);
  let item = items.find(it => direct(it) && available(it));
  let resolved: ResolvedStockCode | null = null;
  if (!item && isNewStockLabelCode(code)) {
    resolved = await resolver(code, storeId);
    const label = resolved;
    if (label) item = items.find(it => available(it) && itemMatchesResolvedStockLabel(it, label));
  }
  return { item, resolved, alreadyScanned: !item && items.some(it => direct(it) || (resolved && itemMatchesResolvedStockLabel(it, resolved))) };
}