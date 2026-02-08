import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendMediaRequest {
  phone: string;
  mediaUrl: string;
  mediaType: 'image' | 'audio' | 'video' | 'document';
  caption?: string;
  filename?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
    const token = Deno.env.get('ZAPI_TOKEN');
    const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');

    if (!instanceId || !token || !clientToken) {
      console.error('Missing Z-API credentials');
      return new Response(
        JSON.stringify({ error: 'Z-API credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { phone, mediaUrl, mediaType, caption, filename }: SendMediaRequest = await req.json();

    if (!phone || !mediaUrl || !mediaType) {
      return new Response(
        JSON.stringify({ error: 'Phone, mediaUrl and mediaType are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format phone number
    let formattedPhone = phone.replace(/\D/g, '');
    if (!formattedPhone.startsWith('55')) {
      formattedPhone = '55' + formattedPhone;
    }

    // Determine Z-API endpoint based on media type
    let endpoint: string;
    let body: Record<string, unknown>;

    switch (mediaType) {
      case 'image':
        endpoint = 'send-image';
        body = {
          phone: formattedPhone,
          image: mediaUrl,
          caption: caption || '',
        };
        break;
      case 'audio':
        endpoint = 'send-audio';
        body = {
          phone: formattedPhone,
          audio: mediaUrl,
        };
        break;
      case 'video':
        endpoint = 'send-video';
        body = {
          phone: formattedPhone,
          video: mediaUrl,
          caption: caption || '',
        };
        break;
      case 'document':
        endpoint = 'send-document';
        body = {
          phone: formattedPhone,
          document: mediaUrl,
          fileName: filename || 'document',
        };
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
