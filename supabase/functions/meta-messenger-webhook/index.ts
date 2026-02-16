import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // GET: Webhook Verification
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = Deno.env.get('META_WHATSAPP_VERIFY_TOKEN'); // reuse same verify token

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Messenger webhook verified');
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // POST: Incoming messages
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN') || '';

    const body = await req.json();
    console.log('Messenger webhook received:', JSON.stringify(body).slice(0, 500));

    if (body.object !== 'page' && body.object !== 'instagram') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const channel = body.object === 'instagram' ? 'instagram' : 'messenger';

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        const timestamp = event.timestamp
          ? new Date(event.timestamp).toISOString()
          : new Date().toISOString();

        if (!senderId) continue;

        // Skip echo messages (messages we sent)
        if (event.message?.is_echo) {
          // Save outgoing message for tracking
          await supabase.from('whatsapp_messages').insert({
            phone: event.recipient?.id || '',
            message: event.message?.text || '[media]',
            direction: 'outgoing',
            message_id: event.message?.mid || null,
            status: 'sent',
            media_type: event.message?.attachments?.[0]?.type || 'text',
            channel,
            is_group: false,
          });
          continue;
        }

        let messageText = '';
        let mediaType = 'text';
        let mediaUrl: string | null = null;

        if (event.message) {
          messageText = event.message.text || '';

          // Handle attachments
          if (event.message.attachments?.length > 0) {
            const att = event.message.attachments[0];
            mediaType = att.type || 'text'; // image, video, audio, file
            mediaUrl = att.payload?.url || null;
            if (!messageText) {
              messageText = `[${mediaType}]`;
            }
          }
        } else if (event.postback) {
          messageText = event.postback.payload || event.postback.title || '[postback]';
        } else if (event.referral) {
          messageText = `[referral: ${event.referral.ref || ''}]`;
        }

        // Get sender profile name
        let senderName: string | null = null;
        if (pageAccessToken) {
          try {
            const profileRes = await fetch(
              `https://graph.facebook.com/v21.0/${senderId}?fields=name,profile_pic&access_token=${pageAccessToken}`
            );
            if (profileRes.ok) {
              const profile = await profileRes.json();
              senderName = profile.name || null;
            }
          } catch (e) {
            console.error('Error fetching sender profile:', e);
          }
        }

        // Save to whatsapp_messages with channel field
        const { error } = await supabase.from('whatsapp_messages').insert({
          phone: senderId,
          message: messageText,
          direction: 'incoming',
          message_id: event.message?.mid || null,
          status: 'received',
          media_type: mediaType,
          media_url: mediaUrl,
          is_group: false,
          channel,
          sender_name: senderName,
        });

        if (error) {
          console.error('Error saving messenger message:', error);
        } else {
          console.log(`Saved ${channel} message from ${senderId} (${senderName || 'unknown'})`);
        }

        // Upsert chat_contacts
        if (senderName) {
          await supabase
            .from('chat_contacts')
            .upsert(
              { phone: senderId, display_name: senderName },
              { onConflict: 'phone', ignoreDuplicates: false }
            );
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Messenger webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
