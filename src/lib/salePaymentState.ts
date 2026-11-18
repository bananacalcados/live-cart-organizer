const PAID_SALE_STATUSES = new Set([
  "paid",
  "completed",
  "concluido",
  "concluída",
  "concluida",
  "finalizado",
  "shipped",
  "delivered",
  "refunded",
]);

/** Considera paga apenas a venda com pagamento confirmado (paid_at ou status de pago). */
export function isSalePaid(sale: { status?: string | null; paid_at?: string | null } | null | undefined): boolean {
  if (!sale) return false;
  const st = String(sale.status || "").toLowerCase();
  if (st === "cancelled" || st === "canceled" || st === "cancelado") return false;
  if (sale.paid_at) return true;
  return PAID_SALE_STATUSES.has(String(sale.status || "").toLowerCase());
}

/**
 * Estado para exibição: venda cancelada que JÁ FOI PAGA (paid_at) é "refunded"
 * (Cancelado - Estorno), não "não paga".
 */
export function getSalePaymentState(sale: { status?: string | null; paid_at?: string | null } | null | undefined): "paid" | "unpaid" | "refunded" {
  if (!sale) return "unpaid";
  const st = String(sale.status || "").toLowerCase();
  if ((st === "cancelled" || st === "canceled" || st === "cancelado") && sale.paid_at) return "refunded";
  return isSalePaid(sale) ? "paid" : "unpaid";
}
