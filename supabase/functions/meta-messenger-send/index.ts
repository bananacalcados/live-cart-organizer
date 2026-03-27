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
    const { recipientId, message, channel = 'instagram', type = 'text', mediaUrl, whatsapp_number_id }: SendMessengerRequest = await req.json();

    if (!recipientId) {
      return new Response(
        JSON.stringify({ error: 'recipientId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve access token: try DB first, then env var fallback
    let pageAccessToken: string | null = null;

    if (whatsapp_number_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, serviceKey);

      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('access_token')
        .eq('id', whatsapp_number_id)
        .eq('provider', 'meta')
        .single();

      if (data?.access_token) {
        pageAccessToken = data.access_token;
        console.log(`Using DB access_token for whatsapp_number_id=${whatsapp_number_id}`);
      }
    }

    // If no DB token found, try all active Meta numbers
    if (!pageAccessToken) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, serviceKey);

      const { data: metaNumbers } = await supabase
        .from('whatsapp_numbers')
        .select('access_token')
        .eq('provider', 'meta')
        .eq('is_active', true)
        .not('access_token', 'is', null)
        .limit(1);

      if (metaNumbers?.[0]?.access_token) {
        pageAccessToken = metaNumbers[0].access_token;
        console.log('Using first active Meta number access_token from DB');
      }
    }

    // Final fallback to env var
    if (!pageAccessToken) {
      pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN') || null;
      if (pageAccessToken) console.log('Using META_PAGE_ACCESS_TOKEN env var fallback');
    }

    if (!pageAccessToken) {
      return new Response(
        JSON.stringify({ error: 'No Meta access token configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    const apiUrl = `https://graph.facebook.com/v21.0/me/messages`;

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
