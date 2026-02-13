import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { flowId, phone, testName } = await req.json();

    if (!flowId || !phone) {
      return new Response(
        JSON.stringify({ error: 'flowId and phone are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch flow steps
    const { data: steps, error: stepsErr } = await supabase
      .from('automation_steps')
      .select('*')
      .eq('flow_id', flowId)
      .order('step_order');

    if (stepsErr || !steps?.length) {
      return new Response(
        JSON.stringify({ error: 'No steps found for this flow' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.length >= 10 && formattedPhone.length <= 11) {
      formattedPhone = '55' + formattedPhone;
    }
    // Brazilian mobile normalization: ensure 13 digits (55 + DDD + 9XXXXXXXX)
    if (formattedPhone.startsWith('55') && formattedPhone.length === 12) {
      const ddd = formattedPhone.substring(2, 4);
      const number = formattedPhone.substring(4);
      if (!number.startsWith('9')) {
        formattedPhone = '55' + ddd + '9' + number;
      }
    }

    const results: Array<{ step: number; type: string; status: string; detail?: string }> = [];

    // Replace customer variables with test data
    function replaceVars(text: string): string {
      return text
        .replace(/\{\{nome\}\}/g, testName || 'Teste')
        .replace(/\{\{telefone\}\}/g, phone)
        .replace(/\{\{email\}\}/g, 'teste@teste.com')
        .replace(/\{\{instagram\}\}/g, '@teste')
        .replace(/\{\{cidade\}\}/g, 'São Paulo')
        .replace(/\{\{pedido_total\}\}/g, 'R$ 199,90')
        .replace(/\{\{produtos\}\}/g, 'Produto Teste x1')
        .replace(/\{\{link_carrinho\}\}/g, 'https://exemplo.com/carrinho')
        .replace(/\{\{cupom\}\}/g, 'TESTE10');
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const config = step.action_config || {};

      // Skip delays entirely in test mode
      if (step.action_type === 'delay') {
        results.push({ step: i + 1, type: 'delay', status: 'skipped', detail: 'Delay zerado no teste' });
        continue;
      }

      // Skip wait_for_reply in test mode
      if (step.action_type === 'wait_for_reply') {
        results.push({ step: i + 1, type: 'wait_for_reply', status: 'skipped', detail: 'Espera ignorada no teste' });
        continue;
      }

      // AI response — call with phone so it reads conversation history
      if (step.action_type === 'ai_response') {
        const aiPrompt = config.prompt || '';
        try {
          const aiRes = await fetch(`${supabaseUrl}/functions/v1/automation-ai-respond`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: aiPrompt, phone: formattedPhone }),
          });
          const aiData = await aiRes.json();
          if (aiRes.ok && aiData.reply) {
            // Send the AI reply via WhatsApp
            const sendRes = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ phone: formattedPhone, message: aiData.reply, whatsappNumberId: config.whatsappNumberId }),
            });
            const sendData = await sendRes.json();
            results.push({ step: i + 1, type: 'ai_response', status: sendRes.ok ? 'sent' : 'error', detail: sendRes.ok ? aiData.reply.slice(0, 80) : sendData.error });

            // Create AI session for continuous conversation
            if (sendRes.ok && config.whatsappNumberId) {
              await supabase.from('automation_ai_sessions').upsert({
                phone: formattedPhone,
                prompt: aiPrompt,
                whatsapp_number_id: config.whatsappNumberId,
                flow_id: flowId,
                is_active: true,
                messages_sent: 1,
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              }, { onConflict: 'phone' });
            }
          } else {
            results.push({ step: i + 1, type: 'ai_response', status: 'error', detail: aiData.error || 'AI sem resposta' });
          }
        } catch (e) {
          results.push({ step: i + 1, type: 'ai_response', status: 'error', detail: e instanceof Error ? e.message : 'Unknown' });
        }
        continue;
      }

      if (step.action_type === 'ai_crosssell') {
        results.push({ step: i + 1, type: step.action_type, status: 'skipped', detail: 'Requer contexto de pedido' });
        continue;
      }

      // Add tag — just log it
      if (step.action_type === 'add_tag') {
        results.push({ step: i + 1, type: 'add_tag', status: 'logged', detail: `Tags: ${(config.tags || []).join(', ')}` });
        continue;
      }

      // Send template
      if (step.action_type === 'send_template') {
        if (!config.templateName) {
          results.push({ step: i + 1, type: 'send_template', status: 'error', detail: 'Template não configurado' });
          continue;
        }

        // Build components from templateVars
        const components: any[] = [];

        // Header media
        if (config.headerMediaUrl) {
          const headerFormat = config.headerMediaUrl.match(/\.(mp4|mov|avi)/i) ? 'video' : 'image';
          components.push({
            type: 'HEADER',
            parameters: [{ type: headerFormat, [headerFormat]: { link: config.headerMediaUrl } }],
          });
        }

        // Body variables
        if (config.templateVars && Object.keys(config.templateVars).length > 0) {
          const bodyParams = Object.keys(config.templateVars)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(k => ({ type: 'text', text: replaceVars(config.templateVars[k]) }));
          components.push({ type: 'BODY', parameters: bodyParams });
        }

        // Button variables
        if (config.buttonVars && Object.keys(config.buttonVars).length > 0) {
          Object.keys(config.buttonVars).forEach(idx => {
            components.push({
              type: 'BUTTON',
              sub_type: 'url',
              index: parseInt(idx),
              parameters: [{ type: 'text', text: config.buttonVars[idx] }],
            });
          });
        }

        // Carousel cards
        if (config.carouselCards && Object.keys(config.carouselCards).length > 0) {
          const cards: any[] = [];
          Object.keys(config.carouselCards).sort().forEach(cardIdx => {
            const cardConf = config.carouselCards[cardIdx];
            const cardComponents: any[] = [];

            if (cardConf.headerUrl) {
              const isVideo = cardConf.headerUrl.match(/\.(mp4|mov|avi)/i);
              const mediaType = isVideo ? 'video' : 'image';
              cardComponents.push({
                type: 'HEADER',
                parameters: [{ type: mediaType, [mediaType]: { link: cardConf.headerUrl } }],
              });
            }

            if (cardConf.bodyVars && Object.keys(cardConf.bodyVars).length > 0) {
              const params = Object.keys(cardConf.bodyVars)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(k => ({ type: 'text', text: replaceVars(cardConf.bodyVars[k]) }));
              cardComponents.push({ type: 'BODY', parameters: params });
            }

            if (cardConf.buttonVars && Object.keys(cardConf.buttonVars).length > 0) {
              Object.keys(cardConf.buttonVars).forEach(btnIdx => {
                cardComponents.push({
                  type: 'BUTTON',
                  sub_type: 'url',
                  index: parseInt(btnIdx),
                  parameters: [{ type: 'text', text: cardConf.buttonVars[btnIdx] }],
                });
              });
            }

            cards.push({ card_index: parseInt(cardIdx), components: cardComponents });
          });

          if (cards.length > 0) {
            components.push({ type: 'CAROUSEL', cards });
          }
        }

        try {
          const sendRes = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send-template`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              phone: formattedPhone,
              templateName: config.templateName,
              language: config.language || 'pt_BR',
              whatsappNumberId: config.whatsappNumberId,
              components: components.length > 0 ? components : undefined,
            }),
          });
          const sendData = await sendRes.json();
          if (sendRes.ok) {
            results.push({ step: i + 1, type: 'send_template', status: 'sent', detail: `Template: ${config.templateName}` });
          } else {
            results.push({ step: i + 1, type: 'send_template', status: 'error', detail: sendData.error || JSON.stringify(sendData) });
          }
        } catch (e) {
          results.push({ step: i + 1, type: 'send_template', status: 'error', detail: e instanceof Error ? e.message : 'Unknown' });
        }
      }

      // Send text message
      if (step.action_type === 'send_text') {
        const message = replaceVars(config.message || '');
        if (!message && !config.mediaUrl) {
          results.push({ step: i + 1, type: 'send_text', status: 'error', detail: 'Mensagem vazia' });
          continue;
        }

        try {
          // Use Meta send for test
          const sendRes = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              phone: formattedPhone,
              message,
              mediaUrl: config.mediaUrl,
              mediaType: config.mediaType,
            }),
          });
          const sendData = await sendRes.json();
          if (sendRes.ok) {
            results.push({ step: i + 1, type: 'send_text', status: 'sent', detail: message.slice(0, 50) });
          } else {
            results.push({ step: i + 1, type: 'send_text', status: 'error', detail: sendData.error || JSON.stringify(sendData) });
          }
        } catch (e) {
          results.push({ step: i + 1, type: 'send_text', status: 'error', detail: e instanceof Error ? e.message : 'Unknown' });
        }
      }

      // Small pause between sends to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in test flow:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error', details: error instanceof Error ? error.message : 'Unknown' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
