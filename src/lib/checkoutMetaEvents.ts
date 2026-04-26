/**
 * Helpers to dispatch Meta Pixel events from the transparent checkout.
 * Each helper fires the BROWSER pixel + the SERVER-SIDE CAPI (deduped via shared event_id).
 */
import { supabase } from "@/integrations/supabase/client";
import { trackPixelEvent, getFbp, getFbc } from "@/lib/metaPixel";

export interface CheckoutEventBase {
  orderId?: string;
  /** Total cart value in BRL */
  value?: number;
  numItems?: number;
  contentIds?: string[];
  /** Optional PII (will be hashed server-side) */
  customer?: {
    fullName?: string;
    email?: string;
    phone?: string;
    cpf?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

function newEventId(prefix: string, orderId?: string) {
  const seed = orderId ? `${orderId}_${Date.now()}` : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${seed}`;
}

async function callCapi(payload: Record<string, unknown>) {
  try {
    const { error } = await supabase.functions.invoke("meta-capi-event", { body: payload });
    if (error) console.warn("[meta-capi-event] error:", error);
  } catch (err) {
    console.warn("[meta-capi-event] exception:", err);
  }
}

function buildCapiBase(eventName: string, eventId: string, base: CheckoutEventBase) {
  const customData: Record<string, unknown> = {
    currency: "BRL",
  };
  if (base.value !== undefined) customData.value = base.value;
  if (base.contentIds && base.contentIds.length) {
    customData.content_ids = base.contentIds;
    customData.content_type = "product";
  }
  if (base.numItems !== undefined) customData.num_items = base.numItems;

  return {
    event_name: eventName,
    event_id: eventId,
    order_id: base.orderId,
    value: base.value,
    currency: "BRL",
    content_ids: base.contentIds,
    content_type: base.contentIds && base.contentIds.length ? "product" : undefined,
    num_items: base.numItems,
    full_name: base.customer?.fullName,
    email: base.customer?.email,
    phone: base.customer?.phone,
    cpf: base.customer?.cpf,
    city: base.customer?.city,
    state: base.customer?.state,
    zip: base.customer?.zip,
    fbp: getFbp() || undefined,
    fbc: getFbc() || undefined,
    client_user_agent: navigator.userAgent,
    action_source: "website",
    event_source_url: window.location.href,
  };
}

function browserCustomData(base: CheckoutEventBase) {
  const data: Record<string, unknown> = { currency: "BRL" };
  if (base.value !== undefined) data.value = base.value;
  if (base.contentIds && base.contentIds.length) {
    data.content_ids = base.contentIds;
    data.content_type = "product";
  }
  if (base.numItems !== undefined) data.num_items = base.numItems;
  return data;
}

/** Step 0 — checkout opened (page load). */
export async function fireInitiateCheckout(base: CheckoutEventBase) {
  const eventId = newEventId("ic", base.orderId);
  trackPixelEvent("InitiateCheckout", browserCustomData(base), { eventID: eventId });
  await callCapi(buildCapiBase("InitiateCheckout", eventId, base));
}

/** Step 1 done — identification (name + cpf + email + phone) collected. */
export async function fireAddPaymentInfo(base: CheckoutEventBase) {
  const eventId = newEventId("api", base.orderId);
  trackPixelEvent("AddPaymentInfo", browserCustomData(base), { eventID: eventId });
  await callCapi(buildCapiBase("AddPaymentInfo", eventId, base));
}

/** Step 2 done — shipping address collected. */
export async function fireAddShippingInfo(base: CheckoutEventBase) {
  const eventId = newEventId("asi", base.orderId);
  trackPixelEvent("AddShippingInfo", browserCustomData(base), { eventID: eventId });
  await callCapi(buildCapiBase("AddShippingInfo", eventId, base));
}

/**
 * Final purchase — fires the BROWSER Purchase event with a deterministic event_id.
 * The CAPI Purchase is fired by the DB trigger when the order moves to 'paid' stage,
 * using the same deterministic event_id (`purchase_order_<orderId>`) for dedupe.
 */
export function firePurchaseBrowser(base: CheckoutEventBase) {
  if (!base.orderId) return;
  const eventId = `purchase_order_${base.orderId}`;
  trackPixelEvent("Purchase", browserCustomData(base), { eventID: eventId });
}
