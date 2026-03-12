import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AnyPayload = Record<string, unknown>;

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value == null) return null;
  return String(value);
}

function getMessageText(payload: AnyPayload): string | null {
  const text = payload.text as unknown;
  if (typeof text === 'string') return text;
  if (text && typeof text === 'object') {
    const msg = (text as Record<string, unknown>).message;
    return asString(msg);
  }
  return null;
}

interface MediaInfo {
  mediaUrl: string;
  mediaType: string;
  caption: string | null;
}

function getMediaInfo(payload: AnyPayload): MediaInfo | null {
  // Image
  const image = payload.image as Record<string, unknown> | undefined;
  if (image) {
    const url = asString(image.imageUrl) || asString(image.url);
    if (url) return { mediaUrl: url, mediaType: 'image', caption: asString(image.caption) };
  }
  // Video
  const video = payload.video as Record<string, unknown> | undefined;
  if (video) {
    const url = asString(video.videoUrl) || asString(video.url);
    if (url) return { mediaUrl: url, mediaType: 'video', caption: asString(video.caption) };
  }
  // Audio
  const audio = payload.audio as Record<string, unknown> | undefined;
  if (audio) {
    const url = asString(audio.audioUrl) || asString(audio.url);
    if (url) return { mediaUrl: url, mediaType: 'audio', caption: null };
  }
  // Document
  const doc = payload.document as Record<string, unknown> | undefined;
  if (doc) {
    const url = asString(doc.documentUrl) || asString(doc.url);
    if (url) return { mediaUrl: url, mediaType: 'document', caption: asString(doc.fileName) || asString(doc.caption) };
  }
  // Sticker
  const sticker = payload.sticker as Record<string, unknown> | undefined;
  if (sticker) {
    const url = asString(sticker.stickerUrl) || asString(sticker.url);
    if (url) return { mediaUrl: url, mediaType: 'image', caption: '🏷️ Sticker' };
  }
  return null;
}

/**
 * Normalize phone number for storage and matching.
 */
function normalizePhone(payload: AnyPayload): { phone: string; isGroup: boolean } {
  const rawPhone = asString(payload.phone) || '';
  const chatLid = asString(payload.chatLid);
  
  const isGroup = rawPhone.includes('-group') || rawPhone.includes('@g.us') || 
                  chatLid?.includes('-group') || chatLid?.includes('@g.us') ||
                  Boolean(payload.isGroup);
  
  if (isGroup) {
    const groupId = rawPhone.replace('@g.us', '').replace('-group', '').replace(/\D/g, '');
    return { phone: groupId, isGroup: true };
  }
  
  let phone = rawPhone.replace(/\D/g, '');
  
  if (phone.length >= 10 && phone.length <= 11) {
    phone = '55' + phone;
  }
  
  if (phone.startsWith('55') && phone.length === 12) {
    const ddd = phone.substring(2, 4);
    const number = phone.substring(4);
    if (!number.startsWith('9')) {
      phone = '55' + ddd + '9' + number;
      console.log(`Normalized 12-digit BR phone to 13: ${rawPhone} -> ${phone}`);
    }
  }
  
  if (phone.length > 13 || phone.length < 12) {
    console.log(`Unusual phone format detected: ${rawPhone} -> ${phone}`);
  }
  
  return { phone, isGroup: false };
}

/**
 * Resolve whatsapp_number_id from multiple sources:
 * 1. ?number_id= query param
 * 2. instanceId in payload → lookup in whatsapp_numbers table
 * 3. connectedPhone in payload → lookup in whatsapp_numbers table
 */
async function resolveWhatsappNumberId(
  supabase: any,
  url: URL,
  payload: AnyPayload
): Promise<string | null> {
  // 1. Query param (highest priority)
  const fromParam = url.searchParams.get('number_id');
  if (fromParam) {
    console.log(`Resolved whatsapp_number_id from query param: ${fromParam}`);
    return fromParam;
  }

  // 2. instanceId lookup
  const instanceId = asString(payload.instanceId);
  if (instanceId) {
    const { data: numRow } = await supabase
      .from('whatsapp_numbers')
      .select('id')
      .eq('zapi_instance_id', instanceId)
      .eq('provider', 'zapi')
      .limit(1)
      .maybeSingle();
    if (numRow) {
      console.log(`Resolved whatsapp_number_id from instanceId ${instanceId}: ${numRow.id}`);
      return numRow.id;
    }
    console.warn(`instanceId ${instanceId} not found in whatsapp_numbers table`);
  }

  // 3. connectedPhone lookup (fallback)
  const connectedPhone = asString(payload.connectedPhone);
  if (connectedPhone) {
    const cleanPhone = connectedPhone.replace(/\D/g, '');
    const { data: numRow } = await supabase
      .from('whatsapp_numbers')
      .select('id')
      .eq('provider', 'zapi')
      .or(`phone_number.eq.${cleanPhone},phone_number.eq.+${cleanPhone},phone_number.ilike.%${cleanPhone.slice(-8)}%`)
      .limit(1)
      .maybeSingle();
    if (numRow) {
      console.log(`Resolved whatsapp_number_id from connectedPhone ${connectedPhone}: ${numRow.id}`);
      return numRow.id;
    }
    console.warn(`connectedPhone ${connectedPhone} not found in whatsapp_numbers table`);
  }

  console.error('FAILED to resolve whatsapp_number_id from any source');
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing backend configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload = (await req.json()) as AnyPayload;
    console.log('Webhook received:', JSON.stringify(payload));

    const url = new URL(req.url);
    const whatsappNumberId = await resolveWhatsappNumberId(supabase, url, payload);

    console.log(`Final resolved whatsapp_number_id: ${whatsappNumberId}`);

    // 1) ReceivedCallback (text and/or media messages)
    const rawPhone = asString(payload.phone);
    const messageText = getMessageText(payload);
    const mediaInfo = getMediaInfo(payload);

    if (rawPhone && (messageText || mediaInfo)) {
      const { phone, isGroup } = normalizePhone(payload);
      const messageId = asString(payload.messageId) || asString(payload.zapiMessageId);
      const fromMe = Boolean(payload.fromMe);
      const statusRaw = asString(payload.status);
      const status = (statusRaw ? statusRaw.toLowerCase() : (fromMe ? 'sent' : 'received'));

      // Build display message: use caption/text or fallback to media type label
      const displayMessage = messageText || mediaInfo?.caption || (mediaInfo ? `📎 ${mediaInfo.mediaType}` : '');

      console.log(`Processing message: phone=${phone}, isGroup=${isGroup}, fromMe=${fromMe}, media=${mediaInfo?.mediaType || 'none'}, numberId=${whatsappNumberId}`);

      if (fromMe) {
        // Dedup: match by phone + message + whatsapp_number_id
        if (messageId && displayMessage) {
          let dedupQuery = supabase
            .from('whatsapp_messages')
            .select('id, message_id')
            .eq('phone', phone)
            .eq('direction', 'outgoing')
            .eq('message', displayMessage)
            .order('created_at', { ascending: false })
            .limit(1);

          if (whatsappNumberId) {
            dedupQuery = dedupQuery.eq('whatsapp_number_id', whatsappNumberId);
          } else {
            dedupQuery = dedupQuery.is('whatsapp_number_id', null);
          }

          const { data: existing } = await dedupQuery;

          const row = existing?.[0];
          if (row && !row.message_id) {
            const { error: updateError } = await supabase
              .from('whatsapp_messages')
              .update({ message_id: messageId, status })
              .eq('id', row.id);

            if (updateError) {
              console.error('Error updating outgoing message (dedup):', updateError);
            }
            return new Response(JSON.stringify({ success: true, dedup: true }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }

        // Fallback: save as outgoing
        const { error: insertError } = await supabase.from('whatsapp_messages').insert({
          phone,
          message: displayMessage,
          direction: 'outgoing',
          message_id: messageId,
          status,
          is_group: isGroup,
          whatsapp_number_id: whatsappNumberId,
          ...(mediaInfo ? { media_type: mediaInfo.mediaType, media_url: mediaInfo.mediaUrl } : {}),
        });

        if (insertError) {
          console.error('Error saving outgoing message:', insertError);
        }
      } else {
        // Incoming message
        const senderName = asString(payload.senderName) || asString(payload.chatName) || asString(payload.pushName) || null;
        
        const { error } = await supabase.from('whatsapp_messages').insert({
          phone,
          message: displayMessage,
          direction: 'incoming',
          message_id: messageId,
          status,
          is_group: isGroup,
          sender_name: senderName,
          whatsapp_number_id: whatsappNumberId,
          ...(mediaInfo ? { media_type: mediaInfo.mediaType, media_url: mediaInfo.mediaUrl } : {}),
        });

        // Reopen conversations that were auto-closed by dispatch
        if (!isGroup) {
          const { data: finished } = await supabase
            .from('chat_finished_conversations')
            .select('id, finish_reason')
            .eq('phone', phone)
            .maybeSingle();
          if (finished && finished.finish_reason === 'disparo_msg') {
            await supabase.from('chat_finished_conversations').delete().eq('id', finished.id);
            console.log(`Reopened dispatch-closed conversation for ${phone}`);
          }
        }

        // NPS capture (only individual chats, only text)
        if (!isGroup && messageText) {
          const trimmed = messageText.trim();
          const score = Number(trimmed);
          if (!Number.isNaN(score) && score >= 0 && score <= 10) {
            const { data: openSurvey } = await supabase
              .from('chat_nps_surveys')
              .select('id')
              .eq('phone', phone)
              .is('responded_at', null)
              .order('sent_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (openSurvey) {
              await supabase.from('chat_nps_surveys').update({
                score,
                responded_at: new Date().toISOString(),
              }).eq('id', openSurvey.id);
            }
          }
        }
        
        // Upsert chat_contacts with display_name from sender
        if (senderName && !isGroup) {
          const { error: contactError } = await supabase
            .from('chat_contacts')
            .upsert(
              { phone, display_name: senderName },
              { onConflict: 'phone', ignoreDuplicates: false }
            );
          if (contactError) console.error('Error upserting chat contact:', contactError);
        }

        // For groups, save the group name
        if (isGroup) {
          const groupName = asString(payload.chatName) || asString(payload.groupName) || asString(payload.name) || null;
          if (groupName) {
            const { error: groupContactError } = await supabase
              .from('chat_contacts')
              .upsert(
                { phone, display_name: groupName },
                { onConflict: 'phone', ignoreDuplicates: false }
              );
            if (groupContactError) console.error('Error upserting group contact:', groupContactError);
          }
        }

        if (error) {
          console.error('Error saving incoming message:', error);
        } else {
          console.log(`Saved incoming ${mediaInfo ? mediaInfo.mediaType : 'text'} message from ${phone}`);
          
          // Trigger incoming_message automations (fire-and-forget) - skip groups
          fetch(`${supabaseUrl}/functions/v1/automation-trigger-incoming`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, messageText: displayMessage, instance: 'zapi', isGroup }),
          }).catch(err => console.error('automation-trigger-incoming error:', err));
        }
      }
    }

    // 2) MessageStatusCallback
    const statusRaw = asString(payload.status);
    const ids = Array.isArray(payload.ids) ? (payload.ids as unknown[]).map(asString).filter(Boolean) as string[] : [];
    const singleId = asString(payload.id);
    const allIds = ids.length > 0 ? ids : (singleId ? [singleId] : []);

    if (statusRaw && allIds.length > 0) {
      const newStatus = statusRaw.toLowerCase();
      const { error } = await supabase
        .from('whatsapp_messages')
        .update({ status: newStatus })
        .in('message_id', allIds);

      if (error) {
        console.error('Error updating status:', error);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
