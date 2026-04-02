import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveZApiCredentials } from "../_shared/zapi-credentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

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
        
        if (mediaUrl.startsWith('data:image/')) {
          // Already a base64 data URI — send directly
          payload = { phone: formattedPhone, image: mediaUrl, caption: caption || '' };
        } else {
          // Send URL directly to Z-API (most reliable method)
          payload = { phone: formattedPhone, image: mediaUrl, caption: caption || '' };
        }
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
    console.log(`[zapi-send-media] Sending ${mediaType} to ${formattedPhone} via ${endpoint}`);
    console.log(`[zapi-send-media] Payload image type: ${mediaUrl.startsWith('data:') ? 'base64' : 'URL'}, URL preview: ${mediaUrl.substring(0, 80)}`);

    const response = await fetch(zapiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log(`[zapi-send-media] Z-API response: ${response.status}`, JSON.stringify(data));

    // If URL-based image send failed or returned error, retry with base64
    if (mediaType === 'image' && !mediaUrl.startsWith('data:') && (!response.ok || data?.error || !data?.zaapId)) {
      console.log('[zapi-send-media] URL-based image failed, retrying with base64 download...');
      try {
        const imgResp = await fetch(mediaUrl);
        if (imgResp.ok) {
          const contentType = imgResp.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
          if (contentType.startsWith('image/')) {
            const bytes = new Uint8Array(await imgResp.arrayBuffer());
            const base64 = uint8ToBase64(bytes);
            const dataUri = `data:${contentType};base64,${base64}`;

            console.log(`[zapi-send-media] Retrying with base64, size: ${bytes.length} bytes`);
            const retryResp = await fetch(zapiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Client-Token': clientToken,
              },
              body: JSON.stringify({ phone: formattedPhone, image: dataUri, caption: caption || '' }),
            });
            const retryData = await retryResp.json();
            console.log(`[zapi-send-media] Base64 retry response: ${retryResp.status}`, JSON.stringify(retryData));

            if (retryResp.ok && !retryData?.error) {
              return new Response(
                JSON.stringify({ success: true, data: retryData, method: 'base64-retry' }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          }
        }
      } catch (retryErr) {
        console.error('[zapi-send-media] Base64 retry error:', retryErr);
      }
    }

    if (!response.ok || data?.error) {
      console.error('[zapi-send-media] Z-API error:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to send media', details: data }),
        { status: response.ok ? 422 : response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[zapi-send-media] Media sent successfully:', data);
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
