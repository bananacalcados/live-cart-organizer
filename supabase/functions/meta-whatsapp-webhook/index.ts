import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Normalize phone: always store as 55XXXXXXXXXXX
 */
function normalizePhone(rawPhone: string): string {
  let phone = rawPhone.replace(/\D/g, '');
  if (phone.length >= 10 && phone.length <= 11) {
    phone = '55' + phone;
  }
  return phone;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // === GET: Webhook Verification ===
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const verifyToken = Deno.env.get('META_WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Webhook verified successfully');
      return new Response(challenge, { status: 200 });
    }

    console.error('Webhook verification failed', { mode, token });
    return new Response('Forbidden', { status: 403 });
  }

  // === POST: Incoming messages & status updates ===
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log('Meta webhook received:', JSON.stringify(body));

    // Meta sends { object: 'whatsapp_business_account', entry: [...] }
    if (body.object !== 'whatsapp_business_account') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        // Process incoming messages
        if (value.messages) {
          for (const msg of value.messages) {
            const rawPhone = msg.from; // e.g. "5533936180084"
            const phone = normalizePhone(rawPhone);
            const messageId = msg.id;
            const timestamp = msg.timestamp
              ? new Date(parseInt(msg.timestamp) * 1000).toISOString()
              : new Date().toISOString();

            let messageText = '';
            let mediaType = 'text';
            let mediaUrl: string | null = null;

            switch (msg.type) {
              case 'text':
                messageText = msg.text?.body || '';
                break;
              case 'image':
                messageText = msg.image?.caption || '[imagem]';
                mediaType = 'image';
                // We'd need to download media via Graph API - store ID for now
                mediaUrl = msg.image?.id || null;
                break;
              case 'video':
                messageText = msg.video?.caption || '[vídeo]';
                mediaType = 'video';
                mediaUrl = msg.video?.id || null;
                break;
              case 'audio':
                messageText = '[áudio]';
                mediaType = 'audio';
                mediaUrl = msg.audio?.id || null;
                break;
              case 'document':
                messageText = msg.document?.caption || msg.document?.filename || '[documento]';
                mediaType = 'document';
                mediaUrl = msg.document?.id || null;
                break;
              case 'reaction':
                messageText = `[reação: ${msg.reaction?.emoji || ''}]`;
                break;
              case 'sticker':
                messageText = '[figurinha]';
                mediaType = 'image';
                mediaUrl = msg.sticker?.id || null;
                break;
              default:
                messageText = `[${msg.type || 'desconhecido'}]`;
            }

            // Save incoming message
            const { error } = await supabase.from('whatsapp_messages').insert({
              phone,
              message: messageText,
              direction: 'incoming',
              message_id: messageId,
              status: 'received',
              media_type: mediaType,
              media_url: mediaUrl,
              is_group: false,
            });

            if (error) {
              console.error('Error saving incoming message:', error);
            } else {
              console.log(`Saved incoming message from ${phone}`);
            }

            // Update last_customer_message_at on matching orders
            // Find customer by phone variations
            const phoneWithoutCountry = phone.startsWith('55') ? phone.slice(2) : phone;
            const phoneVariations = [phone, phoneWithoutCountry];

            // Add variant without 9th digit
            if (phoneWithoutCountry.length === 11 && phoneWithoutCountry.charAt(2) === '9') {
              phoneVariations.push(phoneWithoutCountry.slice(0, 2) + phoneWithoutCountry.slice(3));
              phoneVariations.push('55' + phoneWithoutCountry.slice(0, 2) + phoneWithoutCountry.slice(3));
            }

            const { data: customers } = await supabase
              .from('customers')
              .select('id')
              .in('whatsapp', phoneVariations);

            if (customers && customers.length > 0) {
              const customerIds = customers.map(c => c.id);
              await supabase
                .from('orders')
                .update({
                  has_unread_messages: true,
                  last_customer_message_at: new Date().toISOString(),
                })
                .in('customer_id', customerIds)
                .neq('stage', 'shipped');
            }
          }
        }

        // Process status updates
        if (value.statuses) {
          for (const status of value.statuses) {
            const messageId = status.id;
            let newStatus = 'sent';

            switch (status.status) {
              case 'sent': newStatus = 'sent'; break;
              case 'delivered': newStatus = 'delivered'; break;
              case 'read': newStatus = 'read'; break;
              case 'failed': newStatus = 'failed'; break;
            }

            const { error } = await supabase
              .from('whatsapp_messages')
              .update({ status: newStatus })
              .eq('message_id', messageId);

            if (error) {
              console.error('Error updating message status:', error);
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Meta webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
