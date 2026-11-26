import { buildStockLabelItems, parseLabelQuantity, previewStockAfter, type StockLabelMode } from "@/lib/labels/stockLabelBatch";
import type { StockLabelStorePreview } from "@/lib/labels/stockLabelApi";

/** Mesmo lote do computador: o celular sempre envia escopo "selecionadas" (vazio não mexe). */
export function mobileLabelItems(variantIds: string[], qty: Record<string, string>, mode: StockLabelMode) {
  return buildStockLabelItems(variantIds, qty, mode, "selected");
}

export function stepQty(value: string | undefined, delta: number): string {
  const n = (parseLabelQuantity(value) ?? 0) + delta;
  return n < 0 ? "" : String(n);
}

export function confirmRows(
  variants: { id: string; label: string }[], qty: Record<string, string>,
  mode: Exclude<StockLabelMode, "print_only">, preview: Record<string, StockLabelStorePreview>,
) {
  return variants.flatMap((v) => {
    const q = parseLabelQuantity(qty[v.id]);
    if (q == null) return [];
    const p = preview[v.id] || { stock: 0, pending: 0 };
    return [{ id: v.id, label: v.label, before: p.stock, after: previewStockAfter(mode, p.stock, p.pending, q) }];
  });
}
