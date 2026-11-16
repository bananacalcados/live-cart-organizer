import { supabase } from "@/integrations/supabase/client";

export const PENDING_CHARGE_DELETE_MESSAGE = "Este pedido tem uma cobrança gerada (Pix/cartão) que a cliente ainda pode pagar. Não exclua: cancele o pedido ou mescle com o outro.";

export interface LiveOrderChargeLike {
  is_paid?: boolean | null;
  mercadopago_payment_id?: string | null;
  pagarme_order_id?: string | null;
  vindi_transaction_id?: string | null;
  appmax_order_id?: string | null;
  austpay_transaction_id?: string | null;
  gateway_snapshot?: unknown;
}

export function orderHasGeneratedCharge(order: LiveOrderChargeLike, pendingSplits = 0): boolean {
  if (order.is_paid) return false;
  return [
    order.mercadopago_payment_id,
    order.pagarme_order_id,
    order.vindi_transaction_id,
    order.appmax_order_id,
    order.austpay_transaction_id,
  ].some((value) => !!String(value || "").trim()) || (order.gateway_snapshot != null) || pendingSplits > 0;
}

export async function getOrderDeletionBlock(orderId: string): Promise<string | null> {
  const { data: order, error } = await supabase
    .from("orders")
    .select("is_paid,mercadopago_payment_id,pagarme_order_id,vindi_transaction_id,appmax_order_id,austpay_transaction_id,gateway_snapshot")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order || order.is_paid) return null;
  const { count, error: splitError } = await supabase
    .from("payment_splits")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("status", "pending");
  if (splitError) throw splitError;
  return orderHasGeneratedCharge(order, count || 0) ? PENDING_CHARGE_DELETE_MESSAGE : null;
}
