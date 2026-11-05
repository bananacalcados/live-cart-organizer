// Fase 4 de segurança: regras puras compartilhadas (testadas em payment-gates.test.ts).

export const VALID_PAID_SOURCES = ["gateway_webhook", "manual", "site", "pos", "webhook", "pos_sale"];

/** Motivo para NÃO criar pedido na Shopify, ou null se pode criar. */
export function shopifyOrderBlockReason(order: { is_paid?: boolean | null; paid_at?: string | null; payment_confirmed_source?: string | null; shopify_order_id?: string | null }): string | null {
  if (order.shopify_order_id) return "already_created";
  if (order.is_paid !== true || !order.paid_at) return "not_paid";
  if (!order.payment_confirmed_source || !VALID_PAID_SOURCES.includes(order.payment_confirmed_source)) return "unknown_paid_source";
  return null;
}

/** Pagamento consultado no gateway pertence ao pedido? (referência E valor) */
export function paymentMatchesOrder(p: { reference?: string | null; metadataOrderId?: string | null; amount: number }, orderId: string, minExpected: number, base: number): "ok" | "reference" | "amount" {
  const refOk = (p.reference && p.reference === orderId) || (p.metadataOrderId && p.metadataOrderId === orderId);
  if (!refOk) return "reference";
  const tol = Math.max(1, base * 0.01);
  if (!(p.amount > 0) || p.amount < minExpected - tol) return "amount";
  return "ok";
}

/** Valor enviado pelo navegador confere com o calculado no servidor? (±R$0,05; a mais aceita juros) */
export function clientAmountMatches(clientCents: number | null | undefined, serverCents: number, allowAbove = true): boolean {
  if (clientCents == null || !Number.isFinite(Number(clientCents))) return true; // nada enviado: usa o do servidor
  const c = Math.round(Number(clientCents));
  if (Math.abs(c - serverCents) <= 5) return true;
  return allowAbove && c > serverCents;
}
