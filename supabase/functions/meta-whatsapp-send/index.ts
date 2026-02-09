import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendMessageRequest {
  phone: string;
  message: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'document';
  mediaUrl?: string;
  caption?: string;
  whatsappNumberId?: string;
}

async function getCredentials(supabase: ReturnType<typeof createClient>, whatsappNumberId?: string) {
  if (whatsappNumberId) {
    const { data, error } = await supabase
      .from('whatsapp_numbers')
      .select('phone_number_id, access_token')
      .eq('id', whatsappNumberId)
      .eq('is_active', true)
      .maybeSingle();
    if (data) return { phoneNumberId: data.phone_number_id, accessToken: data.access_token };
  }
  // Fallback: default number
  const { data } = await supabase
    .from('whatsapp_numbers')
    .select('phone_number_id, access_token')
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();
  if (data) return { phoneNumberId: data.phone_number_id, accessToken: data.access_token };
  // Final fallback: env vars
  return {
    phoneNumberId: Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID') || '',
    accessToken: Deno.env.get('META_WHATSAPP_ACCESS_TOKEN') || '',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { phone, message, type = 'text', mediaUrl, caption, whatsappNumberId }: SendMessageRequest = await req.json();

    if (!phone) {
      return new Response(
        JSON.stringify({ error: 'Phone is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { phoneNumberId, accessToken } = await getCredentials(supabase, whatsappNumberId);

    if (!accessToken || !phoneNumberId) {
      return new Response(
        JSON.stringify({ error: 'Meta WhatsApp credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('55')) {
      formattedPhone = '55' + formattedPhone;
    }

    const graphUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    let body: Record<string, unknown>;

    if (type === 'text') {
      if (!message) {
        return new Response(
          JSON.stringify({ error: 'Message is required for text type' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'text',
        text: { body: message },
      };
    } else if (type === 'image' && mediaUrl) {
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'image',
        image: { link: mediaUrl, caption: caption || message || '' },
      };
    } else if (type === 'video' && mediaUrl) {
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'video',
        video: { link: mediaUrl, caption: caption || message || '' },
      };
    } else if (type === 'audio' && mediaUrl) {
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'audio',
        audio: { link: mediaUrl },
      };
    } else if (type === 'document' && mediaUrl) {
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'document',
        document: { link: mediaUrl, caption: caption || message || '' },
      };
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid message type or missing media URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const response = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Meta API error:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to send message', details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const messageId = data.messages?.[0]?.id || null;

    console.log('Meta message sent successfully:', data);
    return new Response(
      JSON.stringify({ success: true, messageId, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending Meta message:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
