import { isLiveContactUnread, type ContactActivity } from "./liveContactUnread";
import { normalizeBRPhone } from "./phoneUtils";

export interface PaidActivityOrder {
  id: string;
  customer?: { whatsapp?: string | null } | null;
  last_customer_message_at?: string | null;
  last_sent_message_at?: string | null;
  has_unread_messages?: boolean;
}
export function paidGroupActivity(group: PaidActivityOrder[], live: Record<string, ContactActivity>, seen: Record<string, number>) {
  let lastIncomingAt: string | null = null;
  let unread = false;
  for (const order of group) {
    const phone = normalizeBRPhone(order.customer?.whatsapp || "");
    const update = live[phone];
    const latest = (a?: string | null, b?: string | null) => !a ? b || null : !b ? a : a > b ? a : b;
    const activity = { lastIn: latest(order.last_customer_message_at, update?.lastIn), lastOut: latest(order.last_sent_message_at, update?.lastOut) };
    lastIncomingAt = latest(lastIncomingAt, activity.lastIn);
    const seenAt = seen[phone.slice(-8)] || 0;
    unread ||= activity.lastIn || activity.lastOut
      ? isLiveContactUnread(activity, seenAt)
      : !!order.has_unread_messages && !seenAt;
  }
  return { unread, lastIncomingAt };
}

export function paidChatOrder<T extends PaidActivityOrder>(representative: T, group: T[]): T {
  return representative.customer?.whatsapp ? representative : group.find((o) => o.customer?.whatsapp) || representative;
}

export function readLiveSeen(eventId: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(`live-contact-seen:${eventId}`) || "{}"); } catch { return {}; }
}
export function markPaidGroupSeen(eventId: string, group: PaidActivityOrder[], seenAt = Date.now()) {
  const seen = readLiveSeen(eventId);
  for (const order of group) {
    const key = normalizeBRPhone(order.customer?.whatsapp || "").slice(-8);
    if (key.length !== 8) continue;
    seen[key] = seenAt;
    window.dispatchEvent(new CustomEvent("live-contact-seen", { detail: { eventId, key, seenAt } }));
  }
  try { localStorage.setItem(`live-contact-seen:${eventId}`, JSON.stringify(seen)); } catch { /* reading remains usable */ }
}