import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveZApiCredentials } from "../_shared/zapi-credentials.ts";
import { prepareZApiImagePayload } from "../_shared/zapi-media.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { phone, mediaUrl, mediaType, caption, filename, whatsapp_number_id } = body;

    console.log('Received body keys:', Object.keys(body), 'whatsapp_number_id:', whatsapp_number_id);

    if (!phone || !mediaUrl || !mediaType) {
      return new Response(
        JSON.stringify({ error: 'Phone, mediaUrl and mediaType are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { instanceId, token, clientToken } = await resolveZApiCredentials(whatsapp_number_id);
    console.log('Resolved credentials - instanceId:', instanceId, 'clientToken prefix:', clientToken?.slice(0, 6));

    // Format phone number
    let formattedPhone = phone.replace(/\D/g, '');
    const isGroup = phone.includes('@') || phone.includes('-') || formattedPhone.startsWith('120');
    if (!isGroup && !formattedPhone.startsWith('55')) {
      formattedPhone = '55' + formattedPhone;
    }

    let endpoint: string;
    let payload: Record<string, unknown>;

    switch (mediaType) {
      case 'image': {
        endpoint = 'send-image';
        const preparedImage = await prepareZApiImagePayload(mediaUrl);
        payload = { phone: formattedPhone, image: preparedImage.image, caption: caption || '' };
        break;
      }
      case 'audio':
        endpoint = 'send-audio';
        payload = { phone: formattedPhone, audio: mediaUrl };
        break;
      case 'video':
        endpoint = 'send-video';
        payload = { phone: formattedPhone, video: mediaUrl, caption: caption || '' };
        break;
      case 'document': {
        // Z-API requires the file extension in the endpoint path, e.g. send-document/pdf
        const docFilename = filename || 'document';
        const ext = mediaUrl.split('?')[0].split('.').pop()?.toLowerCase() || docFilename.split('.').pop()?.toLowerCase() || 'pdf';
        endpoint = `send-document/${ext}`;
        payload = { phone: formattedPhone, document: mediaUrl, fileName: docFilename };
        break;
      }
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid media type' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    const zapiUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}/${endpoint}`;
    console.log(`Sending ${mediaType} to ${formattedPhone} via endpoint=${endpoint}:`, mediaUrl);

    const response = await fetch(zapiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || data?.error) {
      console.error('Z-API error:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to send media', details: data }),
        { status: response.ok ? 422 : response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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