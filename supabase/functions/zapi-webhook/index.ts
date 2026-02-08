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

/**
 * Normalize phone number for storage and matching.
 * Always stores in format: 55XXXXXXXXXXX (country code + phone)
 * Handles different Z-API formats:
 * - Regular phone: "5511999999999" -> "5511999999999"
 * - @lid format: Uses the phone field which should contain the real number
 * - Group format: "120363405872786701-group" -> keep as-is for groups
 */
function normalizePhone(payload: AnyPayload): { phone: string; isGroup: boolean } {
  const rawPhone = asString(payload.phone) || '';
  const chatLid = asString(payload.chatLid);
  
  // Check if it's a group
  const isGroup = rawPhone.includes('-group') || rawPhone.includes('@g.us') || 
                  chatLid?.includes('-group') || chatLid?.includes('@g.us') ||
                  Boolean(payload.isGroup);
  
  // For groups, keep the group ID
  if (isGroup) {
    const groupId = rawPhone.replace('@g.us', '').replace('-group', '').replace(/\D/g, '');
    return { phone: groupId, isGroup: true };
  }
  
  // For regular chats: extract digits only
  let phone = rawPhone.replace(/\D/g, '');
  
  // Handle @lid format in the phone field - Z-API still provides real phone in 'phone' field
  // The @lid is usually in chatLid, the 'phone' field should have the actual number
  
  // If phone looks like a @lid identifier (no country code pattern), it's invalid
  // Brazilian phones: 55 + DDD(2) + phone(8-9) = 12-13 digits
  if (phone.length > 13 || phone.length < 10) {
    // This might be a lid identifier, not a real phone
    // Log it but still store it for matching purposes
    console.log(`Unusual phone format detected: ${rawPhone} -> ${phone}`);
  }
  
  // Ensure it has country code 55 for Brazil
  if (phone.length >= 10 && phone.length <= 11) {
    // Missing country code, add 55
    phone = '55' + phone;
  }
  
  return { phone, isGroup: false };
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

    // 1) ReceivedCallback (text messages) - can include fromMe=true for messages we sent
    const rawPhone = asString(payload.phone);
    const messageText = getMessageText(payload);

    if (rawPhone && messageText) {
      const { phone, isGroup } = normalizePhone(payload);
      const messageId = asString(payload.messageId) || asString(payload.zapiMessageId);
      const fromMe = Boolean(payload.fromMe);
      const statusRaw = asString(payload.status);
      const status = (statusRaw ? statusRaw.toLowerCase() : (fromMe ? 'sent' : 'received'));

      console.log(`Processing message: phone=${phone}, isGroup=${isGroup}, fromMe=${fromMe}`);

      if (fromMe) {
        // Avoid duplicate: when user sends via our UI we already INSERT outgoing with message_id=null.
        // Here we attach message_id/status to the latest matching outgoing row.
        if (messageId) {
          const { data: existing } = await supabase
            .from('whatsapp_messages')
            .select('id, message_id')
            .eq('phone', phone)
            .eq('direction', 'outgoing')
            .eq('message', messageText)
            .order('created_at', { ascending: false })
            .limit(1);

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

        // Fallback: if not found, save as outgoing (still NOT incoming)
        const { error: insertError } = await supabase.from('whatsapp_messages').insert({
          phone,
          message: messageText,
          direction: 'outgoing',
          message_id: messageId,
          status,
          is_group: isGroup,
        });

        if (insertError) {
          console.error('Error saving outgoing message:', insertError);
        }
      } else {
        // Incoming message
        const { error } = await supabase.from('whatsapp_messages').insert({
          phone,
          message: messageText,
          direction: 'incoming',
          message_id: messageId,
          status,
          is_group: isGroup,
        });

        if (error) {
          console.error('Error saving incoming message:', error);
        } else {
          console.log(`Saved incoming message from ${phone}`);
        }
      }
    }

    // 2) MessageStatusCallback
    // payload.ids is usually an array of message ids
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
