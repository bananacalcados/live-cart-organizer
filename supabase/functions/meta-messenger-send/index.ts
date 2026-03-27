import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendMessengerRequest {
  recipientId: string;
  message?: string;
  channel?: 'messenger' | 'instagram';
  type?: 'text' | 'image' | 'video' | 'audio' | 'file';
  mediaUrl?: string;
  whatsapp_number_id?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recipientId, message, channel = 'instagram', type = 'text', mediaUrl }: SendMessengerRequest = await req.json();

    if (!recipientId) {
      return new Response(
        JSON.stringify({ error: 'recipientId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For Instagram/Messenger, always use META_PAGE_ACCESS_TOKEN
    // (WhatsApp Business tokens from whatsapp_numbers table don't work for Instagram DMs)
    const pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN');

    if (!pageAccessToken) {
      return new Response(
        JSON.stringify({ error: 'META_PAGE_ACCESS_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Sending ${channel} message to ${recipientId}, type=${type}`);

    // Build message payload
    let messagePayload: Record<string, unknown>;

    if (type === 'text') {
      messagePayload = { text: message || '' };
    } else if (mediaUrl) {
      const attachmentType = type === 'file' ? 'file' : type;
      messagePayload = {
        attachment: {
          type: attachmentType,
          payload: { url: mediaUrl, is_reusable: true },
        },
      };
    } else {
      return new Response(
        JSON.stringify({ error: 'Message or mediaUrl required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Instagram uses graph.instagram.com; Messenger uses graph.facebook.com
    const apiUrl = channel === 'instagram'
      ? `https://graph.instagram.com/v21.0/me/messages`
      : `https://graph.facebook.com/v21.0/me/messages`;

    console.log(`API URL: ${apiUrl}`);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: messagePayload,
        messaging_type: 'RESPONSE',
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Messenger send error:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to send', details: data }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Message sent successfully to ${recipientId}:`, data.message_id);

    return new Response(
      JSON.stringify({ success: true, messageId: data.message_id, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending messenger message:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
