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
  if (sale.paid_at) return true;
  return PAID_SALE_STATUSES.has(String(sale.status || "").toLowerCase());
}
