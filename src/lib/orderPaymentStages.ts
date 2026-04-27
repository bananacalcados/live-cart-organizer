const PAID_ORDER_STAGES = [
  "paid",
  "awaiting_shipping",
  "awaiting_mototaxi",
  "awaiting_pickup",
  "shipped",
  "completed",
] as const;

export const paidOrderStages = [...PAID_ORDER_STAGES];

type OrderPaymentLike = {
  is_paid?: boolean | null;
  paid_externally?: boolean | null;
  stage?: string | null;
};

export const isPaidOrderStage = (stage?: string | null) => {
  if (!stage) return false;
  return PAID_ORDER_STAGES.includes(stage as (typeof PAID_ORDER_STAGES)[number]);
};

export const isOrderMarkedPaid = (order?: OrderPaymentLike | null) => {
  if (!order) return false;
  return Boolean(order.is_paid || order.paid_externally || isPaidOrderStage(order.stage));
};