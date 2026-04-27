const PAID_ORDER_STAGES = [
  "paid",
  "awaiting_shipping",
  "awaiting_mototaxi",
  "awaiting_pickup",
  "shipped",
  "completed",
] as const;

export const paidOrderStages = [...PAID_ORDER_STAGES];

export const isPaidOrderStage = (stage?: string | null) => {
  if (!stage) return false;
  return PAID_ORDER_STAGES.includes(stage as (typeof PAID_ORDER_STAGES)[number]);
};