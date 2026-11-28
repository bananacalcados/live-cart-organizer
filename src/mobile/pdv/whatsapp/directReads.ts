import { supabase } from "@/integrations/supabase/client";
import { fetchMobileMessagePage as existingPage, fetchMobileMessageUpdates as existingUpdates, type MobileConversation, type MobileMessage } from "@/lib/chat/mobileWhatsappReads";
type Cursor = { created_at: string; id: string };
async function instagramPage(target: MobileConversation, archive: boolean, before?: Cursor, after?: Cursor, ids?: string[]) {
  const { data, error } = await supabase.rpc("mobile_instagram_message_page", { p_phone: target.phone, p_number_id: target.whatsapp_number_id,
    p_archive: archive, p_before_at: before?.created_at, p_before_id: before?.id, p_after_at: after?.created_at, p_after_id: after?.id, p_ids: ids?.slice(0, 100), p_limit: ids ? 100 : 50 });
  if (error) throw error;
  return (data || []) as unknown as MobileMessage[];
}
export function fetchMobileMessagePage(target: MobileConversation, archive = false, before?: Cursor, after?: Cursor) {
  return target.channel === "instagram" ? instagramPage(target, archive, before, after) : existingPage(target, archive, before, after);
}
export function fetchMobileMessageUpdates(target: MobileConversation, ids: string[]) {
  return target.channel === "instagram" ? instagramPage(target, false, undefined, undefined, ids) : existingUpdates(target, ids);
}