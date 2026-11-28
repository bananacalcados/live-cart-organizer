import { supabase } from "@/integrations/supabase/client";
import { type ExpItem, type ExpOrder, type ExpStage, isCarrierWithTracking, isMototaxi, isPickup } from "./expedition";
import { trackingCarrierFor } from "@/lib/logistics/trackingInput";
import { attachRealTracking } from "@/lib/shipmentTracking";
import { saveExpeditionShippingCost } from "./expeditionShippingCost";

export const expeditionItemSnapshot = (item: ExpItem) => ({
  id: item.id, total_qty: item.expedition_total_qty ?? item.quantity, qty: Number(item.quantity) || 0,
  conference: Number(item.expedition_conference_qty) || 0, waiting: Number(item.expedition_waiting_qty) || 0,
  completed: Number(item.expedition_completed_qty) || 0, picked: Number(item.expedition_picked_qty) || 0,
});

export function expeditionOrderSnapshots(orders: ExpOrder[]) {
  return orders.flatMap(order => order.group_snapshots || (order.group_order_ids?.length ? order.group_order_ids : [order.id])
    .map(id => ({ id, stage: order.expedition_stage, ...(order.updated_at && id === order.id ? { updated_at: order.updated_at } : {}) })));
}

export async function moveExpeditionOrders(orders: ExpOrder[], target: ExpStage, mode: "advance" | "items" | "waiting" | "back" | "bulk_back" = "advance") {
  const { data, error } = await supabase.rpc("pos_expedition_transition", {
    p_orders: expeditionOrderSnapshots(orders), p_mode: mode, p_target: target,
    p_items: mode === "advance" || mode === "bulk_back" ? [] : orders.flatMap(o => o.items.map(expeditionItemSnapshot)),
    ...(target === "concluido" ? { p_finished_at: new Date().toISOString() } : {}),
  });
  if (error) throw error;
  return data;
}

export interface ExpeditionShipping {
  carrier: string; tracking: string; trackingUrl: string; deliveryDays: string; courier: string;
  cost: number; courierProviderId?: string; storeId?: string;
}
/** Same existing desktop guards; mobile only uses already-configured shipping in Phase 1. */
export function expeditionShippingError(shipping: ExpeditionShipping): string | null {
  if (!shipping.carrier) return "Selecione a forma de envio";
  if (isCarrierWithTracking(shipping.carrier) && !shipping.tracking.trim()) return "Informe o código de rastreio";
  if (isMototaxi(shipping.carrier) && !shipping.courier.trim()) return "Informe o entregador";
  if (!isPickup(shipping.carrier) && !(shipping.cost >= 0)) return "Informe o valor do envio";
  return null;
}

export async function finishExpedition(order: ExpOrder, checks: Record<string, { scanned: boolean; feet_ok: boolean; has_defect: boolean }>, shipping: ExpeditionShipping) {
  const errorMessage = expeditionShippingError(shipping);
  if (errorMessage) throw new Error(errorMessage);
  const { data, error } = await supabase.rpc("pos_expedition_transition", {
    p_orders: expeditionOrderSnapshots([order]), p_mode: "finish", p_finished_at: new Date().toISOString(),
    p_items: order.items.map(item => ({ ...expeditionItemSnapshot(item), ...checks[item.id] })),
    p_shipping: { carrier: shipping.carrier, tracking_carrier: trackingCarrierFor(shipping.trackingUrl, shipping.tracking, shipping.carrier),
      tracking: shipping.tracking, tracking_url: shipping.trackingUrl, delivery_days: shipping.deliveryDays, courier: shipping.courier },
  });
  if (error) throw error;
  const groupIds = order.group_order_ids?.length ? order.group_order_ids : [order.id];
  // NÃO REMOVER: these two post-commit browser side effects existed before mobile, in this order.
  // A conflict throws above, so it cannot attach tracking or duplicate a delivery cost.
  if (shipping.tracking.trim()) await attachRealTracking({ saleIds: groupIds, realCode: shipping.tracking.trim(), carrier: trackingCarrierFor(shipping.trackingUrl, shipping.tracking, shipping.carrier) });
  await saveExpeditionShippingCost({ saleId: order.id, storeId: shipping.storeId || order.store_id,
    carrier: shipping.carrier, courierProviderId: shipping.courierProviderId, courierName: shipping.courier,
    cost: shipping.cost || 0, customerName: order.customer_name });
  return data as { stage: ExpStage; allCompleted: boolean };
}