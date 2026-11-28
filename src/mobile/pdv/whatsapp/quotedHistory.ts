import { supabase } from '@/integrations/supabase/client';
import { MESSAGE_COLUMNS, mergeMobileMessages, type MobileConversation, type MobileMessage } from '@/lib/chat/mobileWhatsappReads';
import { fetchMobileMessagePage } from './directReads';
export interface QuotedHistory { messages: MobileMessage[]; originalId: string }
/** At most two indexed exact lookups and two bounded context pages, only on tap. */
export async function readQuotedHistory(target: MobileConversation, providerId: string): Promise<QuotedHistory | null> {
  if (!providerId) return null;
  for (const archive of [false, true]) {
    let query = supabase.from(archive ? 'whatsapp_messages_archive' as 'whatsapp_messages' : 'whatsapp_messages')
      .select(MESSAGE_COLUMNS).eq('phone', target.phone).eq('message_id', providerId);
    query = target.whatsapp_number_id ? query.eq('whatsapp_number_id', target.whatsapp_number_id) : query.is('whatsapp_number_id', null);
    if (target.channel === 'instagram') query = query.eq('channel', 'instagram')
      .or('source.is.null,source.not.in.(ig_comment,instagram_comment,live_comment)')
      .or('message.is.null,message.not.like.💬 Comentário%');
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    if (!data) continue;
    const original = data as unknown as MobileMessage;
    const [before, after] = await Promise.all([
      fetchMobileMessagePage(target, archive, original),
      fetchMobileMessagePage(target, archive, undefined, original),
    ]);
    return { messages: mergeMobileMessages(before, [original, ...after]), originalId: original.id };
  }
  return null;
}