import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InteractiveButton {
  id: string;
  title: string;
}

interface InteractiveData {
  header?: { type: string; imageUrl?: string };
  body: string;
  buttons: InteractiveButton[];
}

interface SendMessageRequest {
  phone: string;
  message: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'interactive';
  mediaUrl?: string;
  caption?: string;
  whatsappNumberId?: string;
  interactiveData?: InteractiveData;
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

/**
 * Downloads a media file from a URL and uploads it to Meta's Media API.
 * Returns the media ID to use in the message payload.
 * This avoids the issue where Meta's servers can't fetch images from certain URLs.
 */
async function uploadMediaToMeta(
  mediaUrl: string,
  mediaType: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<string> {
  // Step 1: Download the media from the URL
  console.log(`Downloading media from: ${mediaUrl}`);
  const downloadResponse = await fetch(mediaUrl);
  if (!downloadResponse.ok) {
    throw new Error(`Failed to download media (${downloadResponse.status}): ${mediaUrl}`);
  }

  const contentType = downloadResponse.headers.get('content-type') || getMimeType(mediaType, mediaUrl);
  const mediaBytes = new Uint8Array(await downloadResponse.arrayBuffer());

  console.log(`Downloaded media: ${mediaBytes.length} bytes, content-type: ${contentType}`);

  // Step 2: Upload to Meta's Media API
  const boundary = `----FormBoundary${Date.now()}`;
  const fileName = getFileName(mediaUrl, mediaType);

  // Build multipart form data manually (Deno edge functions)
  const headerPart = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="messaging_product"`,
    ``,
    `whatsapp`,
    `--${boundary}`,
    `Content-Disposition: form-data; name="type"`,
    ``,
    contentType,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    `Content-Type: ${contentType}`,
    ``,
    ``,
  ].join('\r\n');

  const footer = `\r\n--${boundary}--\r\n`;

  const headerBytes = new TextEncoder().encode(headerPart);
  const footerBytes = new TextEncoder().encode(footer);

  const bodyBuffer = new Uint8Array(headerBytes.length + mediaBytes.length + footerBytes.length);
  bodyBuffer.set(headerBytes, 0);
  bodyBuffer.set(mediaBytes, headerBytes.length);
  bodyBuffer.set(footerBytes, headerBytes.length + mediaBytes.length);

  const uploadUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/media`;
  console.log(`Uploading media to Meta: ${uploadUrl}`);

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyBuffer,
  });

  const uploadData = await uploadResponse.json();

  if (!uploadResponse.ok || !uploadData.id) {
    console.error('Meta media upload failed:', uploadData);
    throw new Error(`Meta media upload failed: ${JSON.stringify(uploadData)}`);
  }

  console.log(`Media uploaded to Meta successfully, media_id: ${uploadData.id}`);
  return uploadData.id;
}

function getMimeType(mediaType: string, url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  switch (mediaType) {
    case 'image':
      if (ext === 'png') return 'image/png';
      if (ext === 'webp') return 'image/webp';
      return 'image/jpeg';
    case 'video':
      return 'video/mp4';
    case 'audio':
      if (ext === 'ogg') return 'audio/ogg';
      if (ext === 'webm') return 'audio/webm';
      return 'audio/mpeg';
    case 'document':
      if (ext === 'pdf') return 'application/pdf';
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

function getFileName(url: string, mediaType: string): string {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').pop();
    if (name && name.includes('.')) return name;
  } catch { /* ignore */ }

  switch (mediaType) {
    case 'image': return 'image.jpg';
    case 'video': return 'video.mp4';
    case 'audio': return 'audio.webm';
    case 'document': return 'document.pdf';
    default: return 'file';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { phone, message, type = 'text', mediaUrl, caption, whatsappNumberId, interactiveData }: SendMessageRequest = await req.json();

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
      // Upload media to Meta first, then reference by ID
      const mediaId = await uploadMediaToMeta(mediaUrl, 'image', phoneNumberId, accessToken);
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'image',
        image: { id: mediaId, caption: caption || message || '' },
      };
    } else if (type === 'video' && mediaUrl) {
      const mediaId = await uploadMediaToMeta(mediaUrl, 'video', phoneNumberId, accessToken);
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'video',
        video: { id: mediaId, caption: caption || message || '' },
      };
    } else if (type === 'audio' && mediaUrl) {
      const mediaId = await uploadMediaToMeta(mediaUrl, 'audio', phoneNumberId, accessToken);
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'audio',
        audio: { id: mediaId },
      };
    } else if (type === 'document' && mediaUrl) {
      const mediaId = await uploadMediaToMeta(mediaUrl, 'document', phoneNumberId, accessToken);
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'document',
        document: { id: mediaId, caption: caption || message || '' },
      };
    } else if (type === 'interactive' && interactiveData) {
      // Interactive message with reply buttons (session message, no template needed)
      const interactive: Record<string, unknown> = {
        type: 'button',
        body: { text: interactiveData.body },
        action: {
          buttons: interactiveData.buttons.slice(0, 3).map(btn => ({
            type: 'reply',
            reply: { id: btn.id, title: btn.title.slice(0, 20) },
          })),
        },
      };

      // Add image header if provided — also upload to Meta first
      if (interactiveData.header?.type === 'image' && interactiveData.header.imageUrl) {
        const headerMediaId = await uploadMediaToMeta(interactiveData.header.imageUrl, 'image', phoneNumberId, accessToken);
        interactive.header = { type: 'image', image: { id: headerMediaId } };
      }

      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'interactive',
        interactive,
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
