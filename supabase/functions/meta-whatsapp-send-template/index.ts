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
      const { phoneNumberId, accessToken } = await getCredentials(supabase, whatsappNumberId);

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

            await supabase.from('whatsapp_messages').insert({
              phone: formattedPhone,
              message: `[Template: ${item.template_name}]`,
              direction: 'outgoing',
              message_id: messageId,
              status: 'sent',
            });

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

    const templateBody: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
      },
    };

    if (components && components.length > 0) {
      (templateBody.template as Record<string, unknown>).components = components;
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

      await supabase.from('whatsapp_messages').insert({
        phone: formattedPhone,
        message: renderedMessage || `[Template: ${templateName}]`,
        direction: 'outgoing',
        message_id: messageId,
        status: 'sent',
        media_type: 'text',
        whatsapp_number_id: whatsappNumberDbId,
      });
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
