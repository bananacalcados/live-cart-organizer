import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { webmToOgg, isWebmContainer, isOggContainer } from "../_shared/webm-to-ogg.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InteractiveButton {
  id: string;
  title: string;
}

interface InteractiveData {
  header?: { type: string; imageUrl?: string; image_url?: string };
  body: string;
  buttons: InteractiveButton[];
}

interface SendMessageRequest {
  phone: string;
  message?: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'interactive';
  mediaUrl?: string;
  media_url?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  media_type?: 'image' | 'video' | 'audio' | 'document';
  caption?: string;
  whatsappNumberId?: string;
  whatsapp_number_id?: string;
  interactiveData?: InteractiveData;
  interactive_data?: InteractiveData;
}

async function getCredentials(supabase: ReturnType<typeof createClient>, whatsappNumberId?: string) {
  if (whatsappNumberId) {
    const { data } = await supabase
      .from('whatsapp_numbers')
      .select('phone_number_id, access_token')
      .eq('id', whatsappNumberId)
      .eq('is_active', true)
      .maybeSingle();
    if (data) return { phoneNumberId: data.phone_number_id, accessToken: data.access_token };
  }

  const { data } = await supabase
    .from('whatsapp_numbers')
    .select('phone_number_id, access_token')
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();

  if (data) return { phoneNumberId: data.phone_number_id, accessToken: data.access_token };

  return {
    phoneNumberId: Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID') || '',
    accessToken: Deno.env.get('META_WHATSAPP_ACCESS_TOKEN') || '',
  };
}

function getMimeType(mediaType: string, url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();

  switch (mediaType) {
    case 'image':
      if (ext === 'png') return 'image/png';
      if (ext === 'webp') return 'image/webp';
      if (ext === 'gif') return 'image/gif';
      return 'image/jpeg';
    case 'video':
      if (ext === 'mov') return 'video/quicktime';
      if (ext === 'webm') return 'video/webm';
      return 'video/mp4';
    case 'audio':
      if (ext === 'ogg') return 'audio/ogg';
      if (ext === 'webm') return 'audio/webm';
      if (ext === 'wav') return 'audio/wav';
      return 'audio/mpeg';
    case 'document':
      if (ext === 'pdf') return 'application/pdf';
      if (ext === 'doc') return 'application/msword';
      if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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
  } catch {
    // ignore
  }

  switch (mediaType) {
    case 'image': return 'image.jpg';
    case 'video': return 'video.mp4';
    case 'audio': return 'audio.webm';
    case 'document': return 'document.pdf';
    default: return 'file';
  }
}

const MEDIA_PLACEHOLDER_REGEX = /^\s*[\[{(]?\s*(?:image|imagem|foto|photo|video|vídeo|audio|áudio|document|documento|file|arquivo)\s*[\]})]?\s*$/i;

function normalizeMediaText(value?: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return MEDIA_PLACEHOLDER_REGEX.test(trimmed) ? '' : trimmed;
}

function resolveMediaCaption(message?: string, caption?: string): string | undefined {
  const normalizedCaption = normalizeMediaText(caption);
  if (normalizedCaption) return normalizedCaption;

  const normalizedMessage = normalizeMediaText(message);
  if (normalizedMessage) return normalizedMessage;

  return undefined;
}

// Meta API accepts audio/ogg natively. If we receive webm, do a real remux.
function normalizeContentTypeForMeta(contentType: string, mediaType: string): string {
  if (mediaType === 'audio' && contentType.includes('webm')) {
    return 'audio/ogg';
  }
  return contentType;
}

function normalizeFileNameForMeta(fileName: string, mediaType: string, contentType: string): string {
  if (mediaType === 'audio' && contentType.includes('webm')) {
    return fileName.replace(/\.webm$/i, '.ogg');
  }
  return fileName;
}

async function uploadMediaToMeta(
  mediaUrl: string,
  mediaType: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<string> {
  console.log(`[meta-whatsapp-send] downloading media from ${mediaUrl}`);
  const downloadResponse = await fetch(mediaUrl);

  if (!downloadResponse.ok) {
    throw new Error(`Failed to download media (${downloadResponse.status})`);
  }

  const rawContentType = downloadResponse.headers.get('content-type') || getMimeType(mediaType, mediaUrl);
  let mediaBytes = new Uint8Array(await downloadResponse.arrayBuffer());
  const rawFileName = getFileName(mediaUrl, mediaType);

  // ── Real WebM→OGG remux for audio ──
  let contentType = rawContentType;
  let fileName = rawFileName;

  if (mediaType === 'audio') {
    if (isWebmContainer(mediaBytes)) {
      console.log(`[meta-whatsapp-send] detected WebM container – remuxing to OGG/Opus (${mediaBytes.length} bytes)`);
      try {
        mediaBytes = webmToOgg(mediaBytes);
        contentType = 'audio/ogg';
        fileName = rawFileName.replace(/\.webm$/i, '.ogg');
        console.log(`[meta-whatsapp-send] remux OK – OGG size: ${mediaBytes.length} bytes`);
      } catch (e) {
        console.error('[meta-whatsapp-send] remux failed, sending as-is:', e);
        contentType = normalizeContentTypeForMeta(rawContentType, mediaType);
        fileName = normalizeFileNameForMeta(rawFileName, mediaType, rawContentType);
      }
    } else if (isOggContainer(mediaBytes)) {
      contentType = 'audio/ogg';
      if (!fileName.endsWith('.ogg')) fileName = fileName.replace(/\.\w+$/, '.ogg');
      console.log(`[meta-whatsapp-send] already OGG container (${mediaBytes.length} bytes)`);
    } else {
      contentType = normalizeContentTypeForMeta(rawContentType, mediaType);
      fileName = normalizeFileNameForMeta(rawFileName, mediaType, rawContentType);
      console.log(`[meta-whatsapp-send] unknown audio container, sending with ${contentType}`);
    }
  }

  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', contentType);
  formData.append('file', new Blob([mediaBytes], { type: contentType }), fileName);

  const uploadUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/media`;
  console.log(`[meta-whatsapp-send] uploading media to Meta (${contentType}, ${mediaBytes.length} bytes, original: ${rawContentType})`);

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
    body: formData,
  });

  const uploadData = await uploadResponse.json();

  if (!uploadResponse.ok || !uploadData.id) {
    console.error('[meta-whatsapp-send] Meta media upload failed:', uploadData);
    throw new Error(`Meta media upload failed: ${JSON.stringify(uploadData)}`);
  }

  console.log(`[meta-whatsapp-send] uploaded media_id=${uploadData.id}`);
  return uploadData.id;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const rawBody: SendMessageRequest = await req.json();

    const phone = rawBody.phone;
    const message = rawBody.message || '';
    const whatsappNumberId = rawBody.whatsappNumberId || rawBody.whatsapp_number_id;
    const mediaUrl = rawBody.mediaUrl || rawBody.media_url;
    const normalizedType = rawBody.type && rawBody.type !== 'text'
      ? rawBody.type
      : (rawBody.mediaType || rawBody.media_type || rawBody.type || 'text');
    const interactiveData = rawBody.interactiveData || rawBody.interactive_data;
    const caption = rawBody.caption;
    const resolvedCaption = resolveMediaCaption(message, caption);

    console.log('[meta-whatsapp-send] payload received:', {
      phone,
      type: rawBody.type,
      mediaType: rawBody.mediaType || rawBody.media_type,
      normalizedType,
      hasMediaUrl: !!mediaUrl,
      whatsappNumberId,
    });

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

    if (normalizedType === 'text') {
      if (!message.trim()) {
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
    } else if (normalizedType === 'image' && mediaUrl) {
      const mediaId = await uploadMediaToMeta(mediaUrl, 'image', phoneNumberId, accessToken);
      const imagePayload: Record<string, unknown> = { id: mediaId };
      if (resolvedCaption) imagePayload.caption = resolvedCaption;

      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'image',
        image: imagePayload,
      };
    } else if (normalizedType === 'video' && mediaUrl) {
      const mediaId = await uploadMediaToMeta(mediaUrl, 'video', phoneNumberId, accessToken);
      const videoPayload: Record<string, unknown> = { id: mediaId };
      if (resolvedCaption) videoPayload.caption = resolvedCaption;

      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'video',
        video: videoPayload,
      };
    } else if (normalizedType === 'audio' && mediaUrl) {
      const mediaId = await uploadMediaToMeta(mediaUrl, 'audio', phoneNumberId, accessToken);
      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'audio',
        audio: { id: mediaId },
      };
    } else if (normalizedType === 'document' && mediaUrl) {
      const mediaId = await uploadMediaToMeta(mediaUrl, 'document', phoneNumberId, accessToken);
      const documentPayload: Record<string, unknown> = { id: mediaId };
      if (resolvedCaption) documentPayload.caption = resolvedCaption;

      body = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'document',
        document: documentPayload,
      };
    } else if (normalizedType === 'interactive' && interactiveData) {
      const interactive: Record<string, unknown> = {
        type: 'button',
        body: { text: interactiveData.body },
        action: {
          buttons: interactiveData.buttons.slice(0, 3).map((btn) => ({
            type: 'reply',
            reply: { id: btn.id, title: btn.title.slice(0, 20) },
          })),
        },
      };

      const headerImageUrl = interactiveData.header?.imageUrl || interactiveData.header?.image_url;
      if (interactiveData.header?.type === 'image' && headerImageUrl) {
        const headerMediaId = await uploadMediaToMeta(headerImageUrl, 'image', phoneNumberId, accessToken);
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
        JSON.stringify({
          error: 'Invalid message type or missing media URL',
          details: { normalizedType, hasMediaUrl: !!mediaUrl },
        }),
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
    const details = error instanceof Error ? error.message : 'Unknown error';

    return new Response(
      JSON.stringify({ error: 'Internal server error', details }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
