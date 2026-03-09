import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveZApiCredentials } from "../_shared/zapi-credentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, mediaUrl, mediaType, caption, filename, whatsapp_number_id } = await req.json();

    if (!phone || !mediaUrl || !mediaType) {
      return new Response(
        JSON.stringify({ error: 'Phone, mediaUrl and mediaType are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { instanceId, token, clientToken } = await resolveZApiCredentials(whatsapp_number_id);

    // Format phone number
    let formattedPhone = phone.replace(/\D/g, '');
    const isGroup = phone.includes('@') || phone.includes('-') || formattedPhone.startsWith('120');
    if (!isGroup && !formattedPhone.startsWith('55')) {
      formattedPhone = '55' + formattedPhone;
    }

    let endpoint: string;
    let body: Record<string, unknown>;

    switch (mediaType) {
      case 'image':
        endpoint = 'send-image';
        body = { phone: formattedPhone, image: mediaUrl, caption: caption || '' };
        break;
      case 'audio':
        endpoint = 'send-audio';
        body = { phone: formattedPhone, audio: mediaUrl };
        break;
      case 'video':
        endpoint = 'send-video';
        body = { phone: formattedPhone, video: mediaUrl, caption: caption || '' };
        break;
      case 'document':
        endpoint = 'send-document';
        body = { phone: formattedPhone, document: mediaUrl, fileName: filename || 'document' };
        break;
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid media type' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    const zapiUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}/${endpoint}`;
    console.log(`Sending ${mediaType} to ${formattedPhone}:`, mediaUrl);

    const response = await fetch(zapiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Z-API error:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to send media', details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Media sent successfully:', data);
    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error sending media:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
