/**
 * Decide se uma venda do PDV (`pos_sales`) deve ser reportada à Meta como
 * compra ONLINE (pixel, action_source "website") ou OFFLINE (dataset Visita
 * Loja Física, action_source "physical_store").
 *
 * O critério é COMO O PAGAMENTO ACONTECEU, e não em qual loja a venda foi
 * registrada. Vendas de Live, link de checkout, WhatsApp e PDV > Online são
 * compras de site, mesmo quando registradas sob uma loja física.
 */

export type MetaAttribution = "website" | "offline" | "none";

export interface AttributionInput {
  sale_type?: string | null;
  payment_gateway?: string | null;
  payment_link?: string | null;
  payment_method?: string | null;
  mercadopago_payment_id?: string | null;
  appmax_order_id?: string | null;
  vindi_transaction_id?: string | null;
  pagarme_order_id?: string | null;
  external_source?: string | null;
  source_order_id?: string | null;
  event_id?: string | null;
}

/** Métodos de pagamento que só existem presencialmente (balcão / maquininha). */
const PRESENCIAL_METHODS = [
  "dinheiro",
  "debito",
  "débito",
  "crediario",
  "crediário",
  "vps",
  "point",
  "maquininha",
  "voucher",
  "vale",
];

function isPresencialMethod(method?: string | null): boolean {
  const m = String(method ?? "").trim().toLowerCase();
  if (!m) return false;
  return PRESENCIAL_METHODS.some((p) => m.includes(p));
}

function hasOnlineGatewayTransaction(sale: AttributionInput): boolean {
  return Boolean(
    (sale.payment_gateway && String(sale.payment_gateway).trim()) ||
      (sale.payment_link && String(sale.payment_link).trim()) ||
      sale.mercadopago_payment_id ||
      sale.appmax_order_id ||
      sale.vindi_transaction_id ||
      sale.pagarme_order_id,
  );
}

export function classifySaleAttribution(sale: AttributionInput): {
  attribution: MetaAttribution;
  reason: string;
} {
  const type = String(sale.sale_type ?? "").trim().toLowerCase();

  // Trocas/devoluções não são compra nova — não enviar nada.
  if (type === "exchange" || type === "return" || type === "devolucao") {
    return { attribution: "none", reason: "exchange_or_return_not_a_purchase" };
  }

  // Shopify: o próprio site já dispara pixel + CAPI.
  if (String(sale.external_source ?? "").toLowerCase() === "shopify") {
    return { attribution: "none", reason: "shopify_source_already_sent_by_site" };
  }

  // Live Shopping e vendas online são compras de SITE.
  if (type === "live" || type === "online") {
    return { attribution: "website", reason: `sale_type_${type}` };
  }

  // Pagamento processado por gateway online / link de checkout = compra de SITE.
  if (hasOnlineGatewayTransaction(sale)) {
    return { attribution: "website", reason: "online_gateway_transaction" };
  }

  // Vinculada a um pedido de checkout = compra de SITE.
  if (sale.source_order_id) {
    return { attribution: "website", reason: "linked_to_checkout_order" };
  }

  // Método claramente presencial -> loja física.
  if (isPresencialMethod(sale.payment_method)) {
    return { attribution: "offline", reason: "presential_payment_method" };
  }

  // Padrão: venda de balcão.
  return { attribution: "offline", reason: "default_physical_sale" };
}
