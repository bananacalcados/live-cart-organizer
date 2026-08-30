import { isOrderMarkedPaid } from "@/lib/orderPaymentStages";

export interface RevenueOrderLike {
  products?: Array<{ price?: number | string | null; quantity?: number | string | null }> | null;
  discount_type?: string | null;
  discount_value?: number | null;
  stage?: string | null;
  is_paid?: boolean | null;
  paid_externally?: boolean | null;
}

/** Subtotal dos produtos (sem desconto e sem frete). */
export function orderSubtotal(order: RevenueOrderLike): number {
  return (order.products || []).reduce(
    (sum, p) => sum + (Number(p?.price) || 0) * (Number(p?.quantity) || 0),
    0,
  );
}

/**
 * Valor líquido do pedido: produtos com o desconto do pedido aplicado.
 * Fonte única usada pelo Kanban do evento, pelo Painel da Apresentadora
 * e espelhada pela RPC `event_inner_dashboard`.
 */
export function orderNetValue(order: RevenueOrderLike): number {
  const subtotal = orderSubtotal(order);
  if (!order.discount_type || !order.discount_value) return subtotal;
  const discount =
    order.discount_type === "percentage"
      ? subtotal * (Number(order.discount_value) / 100)
      : Number(order.discount_value);
  return Math.max(0, subtotal - discount);
}

/** Pedido cancelado não entra em nenhuma métrica. */
export function isCancelledOrder(order: RevenueOrderLike): boolean {
  return order.stage === "cancelled";
}

/** Mesmo critério de "pago" em todos os dashboards. */
export function isRevenuePaid(order: RevenueOrderLike): boolean {
  return !isCancelledOrder(order) && isOrderMarkedPaid(order);
}

export interface EventRevenueSummary {
  totalOrders: number;
  paidOrders: number;
  unpaidOrders: number;
  totalValue: number;
  receivedValue: number;
  avgTicket: number;
  conversionRate: number;
}

/** Resumo padronizado: cancelados fora, desconto aplicado, mesmo critério de pago. */
export function summarizeEventRevenue(orders: RevenueOrderLike[]): EventRevenueSummary {
  const active = orders.filter((o) => !isCancelledOrder(o));
  const paid = active.filter((o) => isRevenuePaid(o));

  const totalValue = active.reduce((s, o) => s + orderNetValue(o), 0);
  const receivedValue = paid.reduce((s, o) => s + orderNetValue(o), 0);

  return {
    totalOrders: active.length,
    paidOrders: paid.length,
    unpaidOrders: active.length - paid.length,
    totalValue,
    receivedValue,
    avgTicket: paid.length > 0 ? receivedValue / paid.length : 0,
    conversionRate: active.length > 0 ? (paid.length / active.length) * 100 : 0,
  };
}
