import type { DbOrder } from "@/types/database";
import { normalizeBRPhone } from "@/lib/phoneUtils";

export function completeInitialPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (!/^[1-9]\d9\d{8}$/.test(local)) return null;
  return normalizeBRPhone(local);
}

export interface InitialLiveContact {
  id: string;
  phone: string;
  instagram: string | null;
  created_at: string;
  order_ids: string[];
  confirmed: boolean;
}

/** Display-only telephone: never writes the customer's official identity. */
export function projectInitialPhones(orders: DbOrder[], contacts: InitialLiveContact[]): DbOrder[] {
  return orders.map((order) => {
    if (order.customer?.whatsapp || !order.customer || order.is_paid || order.paid_externally || order.stage === "cancelled") return order;
    const matches = contacts.filter((contact) => contact.order_ids.includes(order.id));
    if (new Set(matches.map((contact) => contact.phone)).size !== 1) return order;
    const contact = matches[0];
    if (!contact) return order;
    return { ...order, customer: { ...order.customer, whatsapp: contact.phone }, initialPhoneUnconfirmed: !contact.confirmed };
  });
}