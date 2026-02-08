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

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
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
    const phoneRaw = asString(payload.phone);
    const messageText = getMessageText(payload);

    if (phoneRaw && messageText) {
      const phone = normalizePhone(phoneRaw);
      const messageId = asString(payload.messageId) || asString(payload.zapiMessageId);
      const fromMe = Boolean(payload.fromMe);
      const statusRaw = asString(payload.status);
      const status = (statusRaw ? statusRaw.toLowerCase() : (fromMe ? 'sent' : 'received'));

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
        });

        if (error) {
          console.error('Error saving incoming message:', error);
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
