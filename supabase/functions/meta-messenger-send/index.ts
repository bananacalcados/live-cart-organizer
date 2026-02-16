import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN');
    if (!pageAccessToken) {
      return new Response(
        JSON.stringify({ error: 'META_PAGE_ACCESS_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { recipientId, message, channel = 'messenger', type = 'text', mediaUrl }: SendMessengerRequest = await req.json();

    if (!recipientId) {
      return new Response(
        JSON.stringify({ error: 'recipientId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // For Instagram, use the Instagram Messaging API endpoint
    const apiUrl = channel === 'instagram'
      ? `https://graph.facebook.com/v21.0/me/messages`
      : `https://graph.facebook.com/v21.0/me/messages`;

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
