export const SELF_SERVICE_CASHBACK_WINDOW_MS = 20 * 60 * 1000;

export function selfserviceCashbackRate(sentAt: string | null, paidAt: string | null): number {
  const sent = sentAt ? Date.parse(sentAt) : NaN;
  const paid = paidAt ? Date.parse(paidAt) : NaN;
  return Number.isFinite(sent) && Number.isFinite(paid) && paid >= sent
    && paid <= sent + SELF_SERVICE_CASHBACK_WINDOW_MS ? 10 : 5;
}

export function selfserviceCashbackAmount(amountPaid: number, rate: number): number {
  return Number.isFinite(amountPaid) && amountPaid > 0 ? Math.round(amountPaid * rate) / 100 : 0;
}
export type CashbackGateway = "mercadopago" | "pagarme" | "austpay" | "appmax" | "vindi";

/** Gateway that REALLY approved: latest successful checkout attempt first, then order-linked ids (never the first id found blindly). */
export function pickConfirmedGateway(
  order: { mercadopago_payment_id?: string | null; pagarme_order_id?: string | null; austpay_transaction_id?: string | null; appmax_order_id?: string | null; vindi_transaction_id?: string | null; notes?: string | null },
  attempts: { gateway?: string | null; status?: string | null; created_at?: string | null }[],
): CashbackGateway | null {
  const norm = (g: string) => (g === "mp" || g.startsWith("mercado") ? "mercadopago" : g) as CashbackGateway;
  const ok = attempts.filter((a) => a.status === "success" && a.gateway)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const a of ok) {
    const g = norm(String(a.gateway).toLowerCase());
    if (["mercadopago", "pagarme", "austpay", "appmax", "vindi"].includes(g)) return g;
  }
  const m = /pago via (\w+)/i.exec(order.notes || "");
  if (m) { const g = norm(m[1].toLowerCase()); if (["mercadopago", "pagarme", "austpay", "appmax", "vindi"].includes(g)) return g; }
  if (order.mercadopago_payment_id) return "mercadopago";
  if (order.austpay_transaction_id) return "austpay";
  if (order.pagarme_order_id) return "pagarme";
  if (order.appmax_order_id) return "appmax";
  if (order.vindi_transaction_id) return "vindi";
  return null;
}

/** "Se foi pago, gera cashback": only system-confirmed payments may skip gateway verification. */
export function canGrantWithoutGateway(source: string | null | undefined): boolean {
  return source === "gateway_webhook" || source === "manual";
}
