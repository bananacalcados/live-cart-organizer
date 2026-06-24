import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendTemplateRequest {
  phone: string;
  templateName: string;
  renderedMessage?: string;
  language?: string;
  whatsappNumberId?: string;
  components?: Array<{
    type: string;
    sub_type?: string;
    index?: number;
    parameters: Array<{
      type: string;
      text?: string;
      image?: { link: string };
      video?: { link: string };
      document?: { link: string; filename?: string };
    }>;
    // Carousel card support
    cards?: Array<{
      card_index: number;
      components: Array<{
        type: string;
        sub_type?: string;
        index?: number;
        parameters: Array<{
          type: string;
          text?: string;
          image?: { link: string };
          video?: { link: string };
        }>;
      }>;
    }>;
  }>;
}

interface BulkSendRequest {
  queueIds: string[];
  whatsappNumberId?: string;
}

async function getCredentials(supabase: ReturnType<typeof createClient>, whatsappNumberId?: string) {
  if (whatsappNumberId) {
    const { data } = await supabase
      .from('whatsapp_numbers')
      .select('phone_number_id, access_token, business_account_id')
      .eq('id', whatsappNumberId)
      .eq('is_active', true)
      .maybeSingle();
    if (data) return { phoneNumberId: data.phone_number_id, accessToken: data.access_token, businessAccountId: data.business_account_id };
    // Explicit instance requested but inactive/not found → fail instead of using default.
    throw new Error(`Instância ${whatsappNumberId} não encontrada ou inativa — envio cancelado para evitar número errado.`);
  }

  const { data } = await supabase
    .from('whatsapp_numbers')
    .select('phone_number_id, access_token, business_account_id')
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();
  if (data) return { phoneNumberId: data.phone_number_id, accessToken: data.access_token, businessAccountId: data.business_account_id };
  return {
    phoneNumberId: Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID') || '',
    accessToken: Deno.env.get('META_WHATSAPP_ACCESS_TOKEN') || '',
    businessAccountId: '',
  };
}

// ── Build the full human-readable message from a template definition + the
// parameters that were actually sent. This lets the chat show the real text
// (with variables filled) and the header image — not just "[Template: x]". ──
const _templateDefCache = new Map<string, any>();

async function fetchTemplateDef(
  accessToken: string,
  businessAccountId: string,
  templateName: string,
  language?: string,
): Promise<any | null> {
  if (!accessToken || !businessAccountId) return null;
  const cacheKey = `${businessAccountId}:${templateName}`;
  let list = _templateDefCache.get(cacheKey);
  if (!list) {
    try {
      const url = `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates?name=${encodeURIComponent(templateName)}&limit=10`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const json = await res.json();
      if (!res.ok) return null;
      list = json.data || [];
      _templateDefCache.set(cacheKey, list);
    } catch (_e) {
      return null;
    }
  }
  if (!list || list.length === 0) return null;
  const byName = list.filter((t: any) => t.name === templateName);
  return byName.find((t: any) => t.language === language) || byName[0] || null;
}

function paramVal(p: any): string {
  if (!p) return '';
  if (typeof p.text === 'string') return p.text;
  if (p.currency?.fallback_value) return p.currency.fallback_value;
  if (p.date_time?.fallback_value) return p.date_time.fallback_value;
  return '';
}

function renderTemplateMessage(
  def: any,
  sentComponents: any[] | undefined,
): { text: string; mediaUrl: string | null; mediaType: string } {
  const sent = sentComponents || [];
  const findSent = (type: string) =>
    sent.find((c: any) => (c.type || '').toLowerCase() === type);

  const subst = (text: string, params: any[]) =>
    text.replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => {
      const idx = parseInt(n, 10) - 1;
      const v = paramVal(params?.[idx]);
      return v || `{{${n}}}`;
    });

  const parts: string[] = [];
  let mediaUrl: string | null = null;
  let mediaType = 'text';

  for (const comp of def?.components || []) {
    const type = (comp.type || '').toUpperCase();
    if (type === 'HEADER') {
      const format = (comp.format || 'TEXT').toUpperCase();
      if (format === 'TEXT' && comp.text) {
        const hp = findSent('header')?.parameters || [];
        parts.push(`*${subst(comp.text, hp)}*`);
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
        const hp = findSent('header')?.parameters || [];
        const mp = hp[0] || {};
        const link =
          mp.image?.link || mp.video?.link || mp.document?.link ||
          comp.example?.header_handle?.[0] || null;
        if (link) {
          mediaUrl = link;
          mediaType = format.toLowerCase();
        }
      }
    } else if (type === 'BODY' && comp.text) {
      const bp = findSent('body')?.parameters || [];
      parts.push(subst(comp.text, bp));
    } else if (type === 'FOOTER' && comp.text) {
      parts.push(`_${comp.text}_`);
    } else if (type === 'BUTTONS' && Array.isArray(comp.buttons)) {
      const labels = comp.buttons
        .map((b: any) => (b.text ? `▸ ${b.text}` : ''))
        .filter(Boolean)
        .join('\n');
      if (labels) parts.push(labels);
    }
  }

  return { text: parts.join('\n\n'), mediaUrl, mediaType };
}

// ── Build a resolved carousel structure (cards: image + body + buttons) from the
// template definition + the components actually sent, so the chat can render the
// full carousel exactly as the customer received it. Returns null if not a carousel.
function buildCarouselPayload(def: any, sentComponents: any[] | undefined): any | null {
  const carouselDef = (def?.components || []).find(
    (c: any) => (c.type || '').toUpperCase() === 'CAROUSEL',
  );
  if (!carouselDef || !Array.isArray(carouselDef.cards)) return null;

  const sent = sentComponents || [];
  const sentCarousel = sent.find((c: any) => (c.type || '').toLowerCase() === 'carousel');
  const sentCards: any[] = sentCarousel?.cards || [];

  // Top-level bubble body text (with variables substituted).
  const bodyDef = (def?.components || []).find((c: any) => (c.type || '').toUpperCase() === 'BODY');
  const sentBody = sent.find((c: any) => (c.type || '').toLowerCase() === 'body');
  const subst = (text: string, params: any[]) =>
    (text || '').replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => {
      const v = paramVal(params?.[parseInt(n, 10) - 1]);
      return v || `{{${n}}}`;
    });
  const bubbleBody = bodyDef?.text ? subst(bodyDef.text, sentBody?.parameters || []) : '';

  const cards = carouselDef.cards.map((cardDef: any, i: number) => {
    const sentCard = sentCards.find((c: any) => c.card_index === i) || sentCards[i] || {};
    const sentCardComps: any[] = sentCard.components || [];
    const findSentComp = (type: string, subType?: string) =>
      sentCardComps.find(
        (c: any) =>
          (c.type || '').toLowerCase() === type &&
          (subType ? (c.sub_type || '').toLowerCase() === subType : true),
      );

    // Image / video from the sent header params.
    const headerParams = findSentComp('header')?.parameters || [];
    const hp = headerParams[0] || {};
    const image_url = hp.image?.link || null;
    const video_url = hp.video?.link || null;

    // Card body (substitute variables).
    const cardBodyDef = (cardDef.components || []).find(
      (c: any) => (c.type || '').toUpperCase() === 'BODY',
    );
    const cardBodyParams = findSentComp('body')?.parameters || [];
    const body = cardBodyDef?.text ? subst(cardBodyDef.text, cardBodyParams) : '';

    // Buttons (resolve URL suffixes from sent button params).
    const btnsDef =
      (cardDef.components || []).find((c: any) => (c.type || '').toUpperCase() === 'BUTTONS')
        ?.buttons || [];
    const buttons = btnsDef.map((b: any, idx: number) => {
      const type = (b.type || '').toUpperCase();
      let url = b.url || undefined;
      if (type === 'URL' && url && url.includes('{{')) {
        const sentBtn = sentCardComps.find(
          (c: any) =>
            (c.type || '').toLowerCase() === 'button' &&
            (c.sub_type || '').toLowerCase() === 'url' &&
            String(c.index) === String(idx),
        );
        const suffix = paramVal(sentBtn?.parameters?.[0]) || '';
        url = url.replace(/\{\{\d+\}\}/, suffix);
      }
      return { type, text: b.text || '', url, phone_number: b.phone_number };
    });

    return { image_url, video_url, body, buttons };
  });

  return { type: 'carousel', body: bubbleBody, cards };
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log('Request body keys:', Object.keys(body), 'whatsappNumberId:', body.whatsappNumberId || body.whatsappNumberId || 'none');

    // === Bulk send from queue ===
    if (body.queueIds) {
      const { queueIds, whatsappNumberId } = body as BulkSendRequest;
      const { phoneNumberId, accessToken, businessAccountId } = await getCredentials(supabase, whatsappNumberId);

      if (!accessToken || !phoneNumberId) {
        return new Response(
          JSON.stringify({ error: 'Meta WhatsApp credentials not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const graphUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

      const { data: queueItems, error: fetchError } = await supabase
        .from('meta_message_queue')
        .select('*')
        .in('id', queueIds)
        .eq('status', 'pending');

      if (fetchError) {
        console.error('Error fetching queue items:', fetchError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch queue items' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const results = [];

      for (const item of queueItems || []) {
        let formattedPhone = item.phone.replace(/\D/g, '');
        if (!formattedPhone.startsWith('55')) {
          formattedPhone = '55' + formattedPhone;
        }

        const templateBody: Record<string, unknown> = {
          messaging_product: 'whatsapp',
          to: formattedPhone,
          type: 'template',
          template: {
            name: item.template_name,
            language: { code: item.template_language || 'pt_BR' },
          },
        };

        if (item.template_params && Array.isArray(item.template_params) && item.template_params.length > 0) {
          (templateBody.template as Record<string, unknown>).components = item.template_params;
        }

        try {
          const response = await fetch(graphUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(templateBody),
          });

          const data = await response.json();

          if (response.ok) {
            const messageId = data.messages?.[0]?.id || null;
            await supabase
              .from('meta_message_queue')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                attempts: item.attempts + 1,
              })
              .eq('id', item.id);

            // Render the full message (text + variables + media) for the chat.
            let bulkText = `[Template: ${item.template_name}]`;
            let bulkMediaUrl: string | null = null;
            let bulkMediaType = 'text';
            try {
              const def = await fetchTemplateDef(accessToken, businessAccountId, item.template_name, item.template_language || 'pt_BR');
              if (def) {
                const r = renderTemplateMessage(def, item.template_params as any[]);
                if (r.text) bulkText = r.text;
                bulkMediaUrl = r.mediaUrl;
                bulkMediaType = r.mediaType;
              }
            } catch (_e) { /* keep fallback */ }

            await supabase.from('whatsapp_messages').insert({
              phone: formattedPhone,
              message: bulkText,
              direction: 'outgoing',
              message_id: messageId,
              status: 'sent',
              media_type: bulkMediaType,
              media_url: bulkMediaUrl,
              whatsapp_number_id: whatsappNumberId || null,
            });

            // Auto-close conversation from dispatch
            await supabase.from('chat_finished_conversations').upsert({
              phone: formattedPhone,
              finished_at: new Date().toISOString(),
              finish_reason: 'disparo_msg',
            } as any, { onConflict: 'phone' });

            results.push({ id: item.id, success: true, messageId });
          } else {
            const errorMsg = data.error?.message || JSON.stringify(data);
            await supabase
              .from('meta_message_queue')
              .update({
                status: item.attempts + 1 >= item.max_attempts ? 'failed' : 'pending',
                error_message: errorMsg,
                attempts: item.attempts + 1,
              })
              .eq('id', item.id);

            results.push({ id: item.id, success: false, error: errorMsg });
          }

          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (sendError) {
          const errorMsg = sendError instanceof Error ? sendError.message : 'Unknown error';
          await supabase
            .from('meta_message_queue')
            .update({
              status: item.attempts + 1 >= item.max_attempts ? 'failed' : 'pending',
              error_message: errorMsg,
              attempts: item.attempts + 1,
            })
            .eq('id', item.id);

          results.push({ id: item.id, success: false, error: errorMsg });
        }
      }

      return new Response(
        JSON.stringify({ success: true, results }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // === Single template send ===
    const { phone, templateName, language = 'pt_BR', components, whatsappNumberId, renderedMessage } = body as SendTemplateRequest;

    if (!phone || !templateName) {
      return new Response(
        JSON.stringify({ error: 'Phone and templateName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { phoneNumberId, accessToken, businessAccountId } = await getCredentials(supabase, whatsappNumberId);

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

    // Pre-fetch the template definition (cached) so we can (a) inject per-card
    // quick-reply payloads for carousel identification and (b) render the chat.
    let templateDef: any | null = null;
    try {
      templateDef = await fetchTemplateDef(accessToken, businessAccountId, templateName, language);
    } catch (_e) { /* non-fatal */ }

    // Inject `bcq:auto:<cardIndex>` payloads on carousel QUICK_REPLY buttons when
    // the caller didn't already provide them. This lets the webhook identify which
    // card the customer tapped, regardless of which send path was used.
    const sendComponents = injectCarouselQuickReplyPayloads(templateDef, components);

    const templateBody: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
      },
    };

    if (sendComponents && sendComponents.length > 0) {
      (templateBody.template as Record<string, unknown>).components = sendComponents;
    }

    const response = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(templateBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Meta API template error:', data);
      return new Response(
        JSON.stringify({ error: 'Failed to send template', details: data }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const messageId = data.messages?.[0]?.id || null;

    // Save the sent template message to whatsapp_messages so it appears in the chat
    try {
      // Find the whatsapp_numbers DB id for this number
      let whatsappNumberDbId: string | null = null;
      if (whatsappNumberId) {
        whatsappNumberDbId = whatsappNumberId;
      } else {
        const { data: defaultNum } = await supabase
          .from('whatsapp_numbers')
          .select('id')
          .eq('is_default', true)
          .eq('is_active', true)
          .maybeSingle();
        whatsappNumberDbId = defaultNum?.id || null;
      }

      // Render the full message (text + variables + media) when the caller
      // didn't pass a renderedMessage, so the chat shows the real content.
      let finalText = renderedMessage || '';
      let finalMediaUrl: string | null = null;
      let finalMediaType = 'text';
      let carouselPayload: any | null = null;
      try {
        const def = await fetchTemplateDef(accessToken, businessAccountId, templateName, language);
        if (def) {
          // Build the full carousel structure (cards) so the chat renders it whole.
          carouselPayload = buildCarouselPayload(def, components);
          if (!finalText) {
            const r = renderTemplateMessage(def, components);
            if (r.text) finalText = r.text;
            finalMediaUrl = r.mediaUrl;
            finalMediaType = r.mediaType;
          }
          // For carousel, prefer the bubble body as the text fallback.
          if (carouselPayload?.body && (!finalText || finalText.startsWith('[Template:'))) {
            finalText = carouselPayload.body;
          }
        }
      } catch (_e) { /* keep fallback */ }
      if (!finalText) finalText = `[Template: ${templateName}]`;

      await supabase.from('whatsapp_messages').insert({
        phone: formattedPhone,
        message: finalText,
        direction: 'outgoing',
        message_id: messageId,
        status: 'sent',
        media_type: finalMediaType,
        media_url: finalMediaUrl,
        template_payload: carouselPayload,
        whatsapp_number_id: whatsappNumberDbId,
      });

      // Auto-close conversation from dispatch
      await supabase.from('chat_finished_conversations').upsert({
        phone: formattedPhone,
        finished_at: new Date().toISOString(),
        finish_reason: 'disparo_msg',
      } as any, { onConflict: 'phone' });
    } catch (saveErr) {
      console.error('Failed to save template message to DB:', saveErr);
    }

    console.log('Meta template sent successfully:', data);
    return new Response(
      JSON.stringify({ success: true, messageId, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending Meta template:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
