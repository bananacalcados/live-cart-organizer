export interface MpSalePaymentRow {
  id: string;
  mercadopago_payment_id?: string | null;
  mp_account_id?: string | null;
}
export interface MpLinkedOrder extends MpSalePaymentRow { pos_sale_id: string | null }
export const MP_SALE_AMBIGUOUS = "Esta venda tem mais de um pagamento — estorno pelo sistema indisponível.";

/** Shared read-only rule; never infer a payment or silently choose ambiguous credentials. */
export function resolveMpSalePayment(sale: MpSalePaymentRow, orders: MpLinkedOrder[]) {
  if (sale.mercadopago_payment_id) return { paymentId: sale.mercadopago_payment_id, accountId: sale.mp_account_id ?? null, orderId: null, error: null };
  const linked = orders.filter((order) => order.pos_sale_id === sale.id && order.mercadopago_payment_id);
  if (new Set(linked.map((order) => order.mercadopago_payment_id)).size > 1 || new Set(linked.map((order) => order.mp_account_id ?? null)).size > 1) {
    return { paymentId: null, accountId: null, orderId: null, error: MP_SALE_AMBIGUOUS };
  }
  const order = linked.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
  return { paymentId: order?.mercadopago_payment_id ?? null, accountId: order?.mp_account_id ?? null, orderId: order?.id ?? null, error: null };
}

/** One bounded batch lookup; errors/truncation fail closed. */
export async function loadMpSalePayments(client: any, sales: MpSalePaymentRow[]) {
  const ids = sales.filter((sale) => !sale.mercadopago_payment_id).map((sale) => sale.id);
  const result = ids.length
    ? await client.from("orders").select("id,pos_sale_id,mercadopago_payment_id,mp_account_id")
      .in("pos_sale_id", ids).not("mercadopago_payment_id", "is", null).limit(201)
    : { data: [], error: null };
  const incomplete = result.error || (result.data?.length ?? 0) > 200;
  return new Map(sales.map((sale) => [sale.id,
    incomplete && !sale.mercadopago_payment_id
      ? { paymentId: null, accountId: null, orderId: null, error: "Não foi possível conferir todos os pagamentos desta venda. Estorno indisponível." }
      : resolveMpSalePayment(sale, result.data ?? []),
  ]));
}