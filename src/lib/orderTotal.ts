import { DbOrder } from "@/types/database";

/**
 * Calcula o valor final de um pedido (produtos - desconto + frete).
 * Mesma fórmula usada no OrderCardDb para consistência.
 */
export function getOrderFinalValue(order: DbOrder): number {
  const totalValue = (order.products || []).reduce(
    (sum, p) => sum + (Number(p.price) || 0) * (Number(p.quantity) || 0),
    0,
  );

  const discountAmount =
    order.discount_type && order.discount_value
      ? order.discount_type === "percentage"
        ? totalValue * (order.discount_value / 100)
        : order.discount_value
      : 0;

  const orderShippingCost = order.free_shipping ? 0 : Number(order.shipping_cost || 0);

  return Math.max(0, totalValue - discountAmount + orderShippingCost);
}
