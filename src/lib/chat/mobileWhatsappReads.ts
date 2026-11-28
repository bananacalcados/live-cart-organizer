import { supabase } from '@/integrations/supabase/client';
import type { Message } from '@/components/chat/ChatTypes';
import type { ChatLane } from '@/lib/chat/conversationLanes';
export interface MobileConversation {
  phone: string; whatsapp_number_id: string | null; last_message: string; last_message_at: string;
  unread_count: number; direction: string; customer_name: string; is_group: boolean; channel: string | null;
  lane: ChatLane; is_live?:boolean; conversation_status: string; assigned_to: string | null; assigned_name: string | null;
  archived: boolean; awaiting_payment: boolean;
}
export const MESSAGE_COLUMNS = 'id,phone,message,direction,created_at,media_type,media_url,status,is_group,whatsapp_number_id,sender_name,sender_phone,message_id,sender_user_id,quoted_message_id,template_payload';
export type MobileMessage = Message & { quoted_message_id?: string | null };
export async function fetchMobileConversationPage(storeId: string, sellerId: string | null, query: string, numberId: string | null, lane: string, offset: number) {
  const { data, error } = await supabase.rpc('mobile_whatsapp_page', { p_store_id: storeId, p_seller_id: sellerId || undefined, p_query: query, p_number_id: numberId || undefined, p_lane: lane, p_limit: 50, p_offset: offset });
  if (error) throw error;
  return (data || []) as unknown as MobileConversation[];
}
/** Cursor is (created_at,id), so ties cannot skip messages. Live table first, archive only after exhaustion. */
export async function fetchMobileMessagePage(target: MobileConversation, archive = false, before?: { created_at: string; id: string }, after?: {created_at:string;id:string}) {
  let q = supabase.from(archive ? 'whatsapp_messages_archive' as 'whatsapp_messages' : 'whatsapp_messages').select(MESSAGE_COLUMNS).eq('phone', target.phone);
  if (!target.is_group) q = target.whatsapp_number_id ? q.eq('whatsapp_number_id', target.whatsapp_number_id) : q.is('whatsapp_number_id', null);
  if (before) q = q.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);
  if (after) q = q.or(`created_at.gt.${after.created_at},and(created_at.eq.${after.created_at},id.gt.${after.id})`);
  const { data, error } = await q.order('created_at', { ascending: !!after }).order('id', { ascending: !!after }).limit(50);
  if (error) throw error;
  const rows=(data || []) as unknown as MobileMessage[];
  return after?rows:rows.reverse();
}
export async function fetchMobileMessageUpdates(target:MobileConversation,ids:string[]) {
  let q=supabase.from('whatsapp_messages').select(MESSAGE_COLUMNS).eq('phone',target.phone).in('id',ids.slice(0,100));
  if(!target.is_group)q=target.whatsapp_number_id?q.eq('whatsapp_number_id',target.whatsapp_number_id):q.is('whatsapp_number_id',null);
  const {data,error}=await q;if(error)throw error;return (data||[]) as unknown as MobileMessage[];
}
export function mergeMobileMessages(previous: MobileMessage[], incoming: MobileMessage[]) {
  const map = new Map(previous.map(m => [m.id, m]));
  incoming.forEach(m => map.set(m.id, m));
  const next = [...map.values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
