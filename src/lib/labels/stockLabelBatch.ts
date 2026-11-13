export type StockLabelMode = "print_only" | "balance" | "add";
export type StockLabelScope = "selected" | "product";

export interface StockLabelQuantityItem {
  variant_id: string;
  qty: number;
}

/** Vazio não participa do lote; zero digitado participa e significa contagem zerada. */
export function parseLabelQuantity(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function buildStockLabelItems(
  variantIds: string[],
  quantities: Record<string, string>,
  mode: StockLabelMode,
  scope: StockLabelScope,
): StockLabelQuantityItem[] {
  const wholeProductBalance = mode === "balance" && scope === "product";
  return variantIds.flatMap((variant_id) => {
    const parsed = parseLabelQuantity(quantities[variant_id]);
    if (parsed == null) return wholeProductBalance ? [{ variant_id, qty: 0 }] : [];
    return [{ variant_id, qty: parsed }];
  });
}

/** Apenas para a confirmação visual; o valor definitivo é sempre calculado no banco. */
export function previewStockAfter(
  mode: Exclude<StockLabelMode, "print_only">,
  stock: number,
  pendingExpedition: number,
  quantity: number,
): number {
  return mode === "balance" ? quantity - pendingExpedition : stock + quantity;
}

export function fillableLabelQuantity(stock: number, pendingExpedition: number): number {
  return Math.max(0, Math.floor(stock + pendingExpedition));
}

export function isExpiredLabelCount(message: string): boolean {
  return message.toLocaleLowerCase("pt-BR").includes("contagem expirada");
}
