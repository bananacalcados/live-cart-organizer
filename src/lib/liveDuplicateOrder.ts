import { supabase } from "@/integrations/supabase/client";
import type { DbOrder } from "@/types/database";

export function livePhoneKey(value?: string | null): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function liveHandleKey(value?: string | null): string {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

export function livePhoneLast4(value?: string | null): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

export interface DuplicateIdentityInput {
  whatsapp?: string | null;
  instagramHandle?: string | null;
  phoneLast4?: string | null;
}

export function isDuplicateLiveOrder(order: DbOrder, input: DuplicateIdentityInput): boolean {
  if (order.is_paid || order.paid_externally || order.stage === "cancelled" || order.merged_into_order_id) return false;
  const phoneKey = livePhoneKey(input.whatsapp);
  if (phoneKey && livePhoneKey(order.customer?.whatsapp) === phoneKey) return true;
  const handle = liveHandleKey(input.instagramHandle);
  const last4 = String(input.phoneLast4 || livePhoneLast4(input.whatsapp));
  return !!handle && /^\d{4}$/.test(last4)
    && liveHandleKey(order.customer?.instagram_handle) === handle
    && String((order as any).phone_last4 || livePhoneLast4(order.customer?.whatsapp)) === last4;
}

export async function findDuplicateLiveOrder(eventId: string, input: DuplicateIdentityInput): Promise<DbOrder | null> {
  if (!livePhoneKey(input.whatsapp) && !(liveHandleKey(input.instagramHandle) && String(input.phoneLast4 || "").length === 4)) return null;
  const { data, error } = await supabase
    .from("orders")
    .select("*,customer:customers(*)")
    .eq("event_id", eventId)
    .eq("is_paid", false)
    .is("merged_into_order_id", null)
    .neq("stage", "cancelled")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data || []) as unknown as DbOrder[]).find((order) => isDuplicateLiveOrder(order, input)) || null;
}
