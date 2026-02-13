import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizePhone(rawPhone: string): string {
  let phone = rawPhone.replace(/\D/g, '');
  if (phone.length >= 10 && phone.length <= 11) {
    phone = '55' + phone;
  }
  // Brazilian mobile normalization: ensure 13 digits (55 + DDD + 9XXXXXXXX)
  if (phone.startsWith('55') && phone.length === 12) {
    const ddd = phone.substring(2, 4);
    const number = phone.substring(4);
    if (!number.startsWith('9')) {
      phone = '55' + ddd + '9' + number;
    }
  }
  return phone;
}

async function downloadMetaMedia(mediaId: string, accessToken: string, supabase: ReturnType<typeof createClient>): Promise<string | null> {
  try {
    // Step 1: Get media URL from Meta
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      console.error('Failed to get media URL:', await metaRes.text());
      return null;
    }
    const metaData = await metaRes.json();
    const mediaUrl = metaData.url;
    if (!mediaUrl) return null;

    // Step 2: Download the binary
    const downloadRes = await fetch(mediaUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!downloadRes.ok) {
      console.error('Failed to download media:', downloadRes.status);
      return null;
    }

    const blob = await downloadRes.blob();
    const mimeType = metaData.mime_type || 'application/octet-stream';
    const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
    const fileName = `meta-${mediaId}.${ext}`;

    // Step 3: Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(fileName, blob, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error('Failed to upload media to storage:', uploadError);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from('whatsapp-media')
      .getPublicUrl(fileName);

    return publicUrlData?.publicUrl || null;
  } catch (err) {
    console.error('Error downloading Meta media:', err);
    return null;
  }
}

async function getAccessTokenForPhoneNumberId(supabase: ReturnType<typeof createClient>, metaPhoneNumberId: string): Promise<{ accessToken: string; numberId: string } | null> {
  const { data } = await supabase
    .from('whatsapp_numbers')
    .select('id, access_token')
    .eq('phone_number_id', metaPhoneNumberId)
    .eq('is_active', true)
    .maybeSingle();
  if (data) return { accessToken: data.access_token, numberId: data.id };

  // Fallback to default
  const { data: def } = await supabase
    .from('whatsapp_numbers')
    .select('id, access_token')
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();
  if (def) return { accessToken: def.access_token, numberId: def.id };

  const fallbackToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN') || '';
  return fallbackToken ? { accessToken: fallbackToken, numberId: '' } : null;
}

serve(async (req) => {
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

        // Determine which WhatsApp number received this
        const metaPhoneNumberId = value.metadata?.phone_number_id || '';
        const creds = await getAccessTokenForPhoneNumberId(supabase, metaPhoneNumberId);
        const accessToken = creds?.accessToken || '';
        const whatsappNumberDbId = creds?.numberId || null;

        // Process incoming messages
        if (value.messages) {
          for (const msg of value.messages) {
            const phone = normalizePhone(msg.from);
            const messageId = msg.id;
            const timestamp = msg.timestamp
              ? new Date(parseInt(msg.timestamp) * 1000).toISOString()
              : new Date().toISOString();

            let messageText = '';
            let mediaType = 'text';
            let mediaUrl: string | null = null;
            let rawMediaId: string | null = null;

            switch (msg.type) {
              case 'text':
                messageText = msg.text?.body || '';
                break;
              case 'image':
                messageText = msg.image?.caption || '[imagem]';
                mediaType = 'image';
                rawMediaId = msg.image?.id || null;
                break;
              case 'video':
                messageText = msg.video?.caption || '[vídeo]';
                mediaType = 'video';
                rawMediaId = msg.video?.id || null;
                break;
              case 'audio':
                messageText = '[áudio]';
                mediaType = 'audio';
                rawMediaId = msg.audio?.id || null;
                break;
              case 'document':
                messageText = msg.document?.caption || msg.document?.filename || '[documento]';
                mediaType = 'document';
                rawMediaId = msg.document?.id || null;
                break;
              case 'reaction':
                messageText = `[reação: ${msg.reaction?.emoji || ''}]`;
                break;
              case 'sticker':
                messageText = '[figurinha]';
                mediaType = 'image';
                rawMediaId = msg.sticker?.id || null;
                break;
              default:
                messageText = `[${msg.type || 'desconhecido'}]`;
            }

            // Download media if present
            if (rawMediaId && accessToken) {
              const downloadedUrl = await downloadMetaMedia(rawMediaId, accessToken, supabase);
              mediaUrl = downloadedUrl;
            }

            // Get sender name from contacts array
            const contact = value.contacts?.find((c: any) => c.wa_id === msg.from);
            const senderName = contact?.profile?.name || null;

            const { error } = await supabase.from('whatsapp_messages').insert({
              phone,
              message: messageText,
              direction: 'incoming',
              message_id: messageId,
              status: 'received',
              media_type: mediaType,
              media_url: mediaUrl,
              is_group: false,
              whatsapp_number_id: whatsappNumberDbId || null,
              sender_name: senderName,
            });

            if (error) {
              console.error('Error saving incoming message:', error);
            } else {
              console.log(`Saved incoming message from ${phone} (${senderName || 'unknown'})`);

              // Check for active AI session and auto-respond
              try {
                const { data: aiSession } = await supabase
                  .from('automation_ai_sessions')
                  .select('*')
                  .eq('phone', phone)
                  .eq('is_active', true)
                  .gt('expires_at', new Date().toISOString())
                  .maybeSingle();

                if (aiSession && messageText && msg.type === 'text') {
                  console.log(`Active AI session found for ${phone}, auto-responding...`);

                  // Call AI to generate response
                  const aiRes = await fetch(`${supabaseUrl}/functions/v1/automation-ai-respond`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${supabaseKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      prompt: aiSession.prompt,
                      phone: phone,
                    }),
                  });
                  const aiData = await aiRes.json();

                  if (aiRes.ok && aiData.reply) {
                    // Send AI reply via the same WhatsApp number
                    const sendRes = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${supabaseKey}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        phone: phone,
                        message: aiData.reply,
                        whatsappNumberId: aiSession.whatsapp_number_id,
                      }),
                    });
                    
                    // Update session counter
                    const newCount = (aiSession.messages_sent || 0) + 1;
                    if (newCount >= (aiSession.max_messages || 50)) {
                      await supabase.from('automation_ai_sessions').update({ is_active: false, messages_sent: newCount }).eq('id', aiSession.id);
                    } else {
                      await supabase.from('automation_ai_sessions').update({ messages_sent: newCount, updated_at: new Date().toISOString() }).eq('id', aiSession.id);
                    }
                    
                    console.log(`AI auto-reply sent to ${phone}: ${aiData.reply.slice(0, 50)}...`);
                  }
                }
              } catch (aiErr) {
                console.error('AI auto-respond error:', aiErr);
              }
            }

            // Upsert chat_contacts with display_name
            if (senderName) {
              await supabase
                .from('chat_contacts')
                .upsert(
                  { phone, display_name: senderName },
                  { onConflict: 'phone', ignoreDuplicates: false }
                );
            }

            // Update orders
            const phoneWithoutCountry = phone.startsWith('55') ? phone.slice(2) : phone;
            const phoneVariations = [phone, phoneWithoutCountry];
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

            const updateData: Record<string, unknown> = { status: newStatus };

            // Capture error details for failed messages
            if (newStatus === 'failed' && status.errors && status.errors.length > 0) {
              const err = status.errors[0];
              updateData.error_code = String(err.code || '');
              const details = err.error_data?.details || err.message || err.title || 'Erro desconhecido';
              updateData.error_message = `${err.title || 'Erro'} (${err.code || '?'}): ${details}`;
              console.log(`Message ${messageId} failed: code=${err.code}, title=${err.title}, details=${details}`);
            }

            await supabase
              .from('whatsapp_messages')
              .update(updateData)
              .eq('message_id', messageId);
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
