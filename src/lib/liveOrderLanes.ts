import type { DbOrder } from "@/types/database";

/** The lane follows the conversation opened by the card, not an unrelated channel. */
export function isLiveOrderConversationUnread(hasWhatsApp: boolean, whatsappUnread: boolean, instagramUnread: boolean): boolean {
  return hasWhatsApp ? whatsappUnread : instagramUnread;
}

/** Exact order registration only; never enrich by a shared phone or handle. */
export function projectRegistrationPhones(orders: DbOrder[], phones: Record<string, string>): DbOrder[] {
  return orders.map((order) => {
    const phone = phones[order.id];
    if (!phone || order.customer?.whatsapp || !order.customer) return order;
    return { ...order, customer: { ...order.customer, whatsapp: phone } };
  });
}

export function isLiveOrderIncomplete(order: DbOrder): boolean {
  return !order.customer?.whatsapp?.replace(/\D/g, "") || !order.products?.length;
}