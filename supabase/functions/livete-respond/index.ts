import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { liveteTools, executeToolCall } from "../_shared/livete-tools.ts";
import { transcribeAudio } from "../_shared/audio-transcribe.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function typingDelay(text: string): number {
  const chars = text.length;
  const seconds = Math.max(2, Math.min(12, chars / 40));
  return Math.round(seconds * (0.8 + Math.random() * 0.4) * 1000);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { phone, messageText, whatsappNumberId, mediaUrl, mediaType } = await req.json();
    if (!phone || (!messageText && !mediaUrl)) {
      return new Response(JSON.stringify({ error: 'phone and messageText or mediaUrl required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[livete-respond] phone=${phone}, msg="${(messageText || '').slice(0, 80)}", media=${mediaType || 'none'}`);

    // ─── DEBOUNCE ───
    await sleep(4000);

    const { data: latestMsgs } = await supabase
      .from('whatsapp_messages')
      .select('message, created_at')
      .eq('phone', phone)
      .eq('direction', 'incoming')
      .order('created_at', { ascending: false })
      .limit(1);

    const latestMsg = latestMsgs?.[0];
    if (latestMsg && messageText && latestMsg.message !== messageText) {
      console.log(`[livete-respond] Skipping: newer message detected for ${phone}`);
      return new Response(JSON.stringify({ handled: false, reason: 'debounced' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Combine fragmented messages
    const thirtySecsAgo = new Date(Date.now() - 30000).toISOString();
    const { data: recentMsgs } = await supabase
      .from('whatsapp_messages')
      .select('message, media_url, media_type')
      .eq('phone', phone)
      .eq('direction', 'incoming')
      .gte('created_at', thirtySecsAgo)
      .order('created_at', { ascending: true });

    let combinedMessage = (recentMsgs && recentMsgs.length > 1)
      ? recentMsgs.map(m => m.message).filter(Boolean).join('\n')
      : (messageText || '');

    // Append audio transcription to combined message (resolved later after transcription)
    // This variable will be updated after transcription completes

    // Collect any media from recent messages
    const recentMediaUrl = mediaUrl || recentMsgs?.find(m => m.media_url && m.media_type?.startsWith('image'))?.media_url;

    // Transcribe audio if present
    const audioUrl = (mediaType === 'audio' && mediaUrl)
      ? mediaUrl
      : recentMsgs?.find(m => m.media_url && m.media_type === 'audio')?.media_url;

    let audioTranscription: string | null = null;
    if (audioUrl) {
      console.log(`[livete-respond] Transcribing audio for ${phone}...`);
      audioTranscription = await transcribeAudio(audioUrl);
      if (audioTranscription) {
        console.log(`[livete-respond] Audio transcribed: "${audioTranscription.slice(0, 100)}"`);
      }
    }

    // Append audio transcription to combined message
    if (audioTranscription) {
      const audioPrefix = '[Áudio transcrito]: ';
      combinedMessage = combinedMessage
        ? `${combinedMessage}\n${audioPrefix}${audioTranscription}`
        : `${audioPrefix}${audioTranscription}`;
    }


    const { data: session } = await supabase
      .from('automation_ai_sessions')
      .select('*')
      .eq('phone', phone)
      .eq('is_active', true)
      .maybeSingle();

    if (!session || !session.prompt?.startsWith('livete_checkout:')) {
      return new Response(JSON.stringify({ handled: false, reason: 'no_active_session' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── CROSS-INSTANCE DETECTION ───
    // If the message came from a different WhatsApp number than the session's, flag it
    const isCrossInstance = whatsappNumberId && session.whatsapp_number_id
      && whatsappNumberId !== session.whatsapp_number_id;

    const orderId = session.prompt.replace('livete_checkout:', '');

    // 2. Load order
    const { data: order } = await supabase
      .from('orders')
      .select('id, event_id, customer_id, products, stage, stage_atendimento, ai_paused, shipping_cost, free_shipping, discount_type, discount_value, cart_link, delivery_method, created_at')
      .eq('id', orderId)
      .single();

    if (!order) {
      return new Response(JSON.stringify({ handled: false, reason: 'order_not_found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (order.ai_paused) {
      return new Response(JSON.stringify({ handled: false, reason: 'ai_paused' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── EVENT AGE CHECK ───
    const orderAgeHours = (Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60);
    const isOldOrder = orderAgeHours > 48;

    // Load event date for more context
    let eventDate: string | null = null;
    if (order.event_id) {
      const { data: evt } = await supabase.from('events').select('date').eq('id', order.event_id).single();
      if (evt?.date) eventDate = evt.date;
    }
    const eventAgeHours = eventDate ? (Date.now() - new Date(eventDate).getTime()) / (1000 * 60 * 60) : orderAgeHours;

    // Hard cutoff: if order is older than 5 days, deactivate session entirely
    if (orderAgeHours > 120) {
      console.log(`[livete-respond] Order ${orderId} is ${Math.round(orderAgeHours)}h old — deactivating session`);
      await supabase.from('automation_ai_sessions').update({
        is_active: false, updated_at: new Date().toISOString(),
      }).eq('id', session.id);
      return new Response(JSON.stringify({ handled: false, reason: 'order_too_old' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Load customer, registration, history, knowledge base
    const { data: customer } = await supabase
      .from('customers')
      .select('id, instagram_handle, whatsapp, live_cancellation_count')
      .eq('id', order.customer_id)
      .single();

    const { data: registration } = await supabase
      .from('customer_registrations')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    const { data: history } = await supabase
      .from('whatsapp_messages')
      .select('message, direction, created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(20);

    const conversationHistory = (history || []).reverse().map((m: any) =>
      `${m.direction === 'outgoing' ? 'Livete' : 'Cliente'}: ${m.message}`
    ).join('\n');

    const { data: kb } = await supabase
      .from('ai_knowledge_base')
      .select('category, title, content')
      .eq('is_active', true);

    const knowledgeText = (kb || []).map((k: any) =>
      `[${k.category}] ${k.title}: ${k.content}`
    ).join('\n');

    // 4. Calculate order totals
    const products = (order.products as any[]) || [];
    const subtotal = products.reduce((sum: number, p: any) =>
      sum + (Number(p.price || 0) * Number(p.quantity || 1)), 0);
    let discountAmount = 0;
    if (order.discount_value && Number(order.discount_value) > 0) {
      if (order.discount_type === 'fixed') discountAmount = Number(order.discount_value);
      else if (order.discount_type === 'percentage') discountAmount = subtotal * (Number(order.discount_value) / 100);
    }
    const total = Math.max(0, subtotal - discountAmount);

    const productsSummary = products.map((p: any) =>
      `${p.quantity || 1}x ${p.title}${p.variant ? ` (${p.variant})` : ''} — R$${Number(p.price || 0).toFixed(2)}`
    ).join(', ');

    const currentStage = order.stage_atendimento || 'endereco';
    const regData = registration ? {
      nome: registration.full_name || '', cpf: registration.cpf || '', email: registration.email || '',
      cep: registration.cep || '', endereco: registration.address || '', numero: registration.address_number || '',
      complemento: registration.complement || '', bairro: registration.neighborhood || '',
      cidade: registration.city || '', estado: registration.state || '',
    } : {};

    // 5. Build system prompt (tool calling — no JSON output required)
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ handled: false, reason: 'no_api_key' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cancellationCount = customer?.live_cancellation_count || 0;

    const systemPrompt = `Você é a Livete, atendente da Banana Calçados no WhatsApp durante uma live. Converse como uma pessoa real — simpática, leve e direta.

${isCrossInstance ? `## ⚠️ ATENÇÃO: CONVERSA CROSS-INSTANCE
O cliente está te respondendo por um OUTRO número de WhatsApp diferente do que o pedido foi iniciado.
- NÃO comece cobrando pagamento ou falando do pedido diretamente.
- Comece com algo suave como: "Oi [nome]! Vi que estávamos conversando no outro número 😊 É sobre o pedido da live?"
- Deixe o cliente confirmar antes de prosseguir com o fluxo do pedido.
- Se o cliente quiser falar de outro assunto, transfira para um atendente humano (use notify_presenter com alert_type "transfer_human").
` : ''}
${isOldOrder ? `## ⚠️ PEDIDO ANTIGO (${Math.round(orderAgeHours)}h atrás)
Este pedido foi feito há mais de 2 dias. NÃO cobre pagamento automaticamente.
- Aborde de forma suave: "Oi [nome]! Tudo bem? 😊 Posso te ajudar com alguma coisa?"
- Se o cliente perguntar sobre o pedido, confirme se ele ainda tem interesse.
- Se não demonstrar interesse, encerre educadamente e use cancel_order se necessário.
- NÃO gere PIX nem envie links de pagamento sem o cliente confirmar que quer prosseguir.
` : ''}
## Como falar
- Frases CURTAS. Máximo 2-3 linhas por mensagem.
- Mensagens maiores SÓ para listas (resumo do pedido, endereço).
- Use emojis com moderação (1-2 por mensagem).
- SEMPRE termine com uma pergunta natural para manter o engajamento.
- Nunca invente informação. Use só o que sabe.
- Não repita perguntas já respondidas.
- Na PRIMEIRA mensagem da conversa, NUNCA vá direto ao pagamento. Cumprimente e pergunte se o cliente precisa de ajuda.

## Base de Conhecimento
${knowledgeText}

## Pedido Atual
- Produtos: ${productsSummary}
- Subtotal: R$${subtotal.toFixed(2)}
${discountAmount > 0 ? `- Desconto: -R$${discountAmount.toFixed(2)}` : ''}
- Total: R$${total.toFixed(2)}
- Frete grátis: ${order.free_shipping ? 'Sim' : 'Não'}
- Link pagamento cartão: ${order.cart_link || 'não gerado'}

## Dados já coletados
${JSON.stringify(regData, null, 2)}

## Etapa Atual: ${currentStage}
## Cancelamentos anteriores: ${cancellationCount}/3 ${cancellationCount >= 2 ? '⚠️ PRÓXIMO CANCELAMENTO = BAN' : ''}

## Fluxo de etapas (use a tool advance_stage para avançar):
1. endereco → Pegar endereço completo. Se "retirada na loja", aceite e dê frete grátis.
2. confirmar_endereco → Confirmar endereço salvo.
3. dados_pessoais → Nome Completo, CPF, E-mail (email é opcional).
4. forma_pagamento → PIX, Cartão (até 3x sem juros), Boleto ou Pagar na Loja.
5. aguardando_pix → PIX será gerado automaticamente.
6. aguardando_cartao → Envie o link de pagamento.
7. aguardando_boleto → Boleto gerado e enviado.
8. aguardando_pagamento_loja → Cliente pagará na retirada.
9. pago → Pagamento confirmado.

## ═══ REGRAS DE NEGÓCIO (OBRIGATÓRIAS) ═══

### Coleta de Dados — SEMPRE dê um motivo válido
- NUNCA peça dados de forma genérica ("me passa seu nome, CPF, email").
- SEMPRE justifique: "Pra separar seu produto e emitir a NF, vou precisar dos seus dados..."
- Exemplo BOM: "Maravilha, vou separar os produtos pra você! Pra montar seu pedido, qual seu nome completo?"
- QUEBRE as perguntas em partes — NÃO peça tudo de uma vez.
- Primeiro peça Nome, depois CPF, depois Email.
- Email NÃO é obrigatório. Se o cliente hesitar ou disser que não tem, diga que tudo bem e prossiga sem email.
- Clientes idosas podem não ter email ou ter dificuldade. Seja sensível.
- Endereço é SEMPRE necessário, mesmo para retirada na loja (para emissão de NFe).

### Retirada na Loja
- Dê FRETE GRÁTIS automaticamente (use update_order_shipping com free_shipping=true).
- Pergunte qual loja: Centro ou Pérola.
- Use save_customer_data com delivery_method="pickup".
- Identifique forma de pagamento:
  - PIX → Pode pagar na hora. Gere PIX normalmente.
  - Dinheiro ou Cartão → Provavelmente quer pagar na loja. Use advance_stage para "aguardando_pagamento_loja".
  - Se for pagar na loja, peça CONFIRMAÇÃO de que realmente vai ficar com o produto.
- Retirada deve ser em no máximo 1 dia útil.
- MESMO sendo retirada, colete TODOS os dados (nome, CPF, email, endereço completo) para NFe.

### Entrega Local (Valadares)
- Disponível APENAS dentro de Governador Valadares.
- Se a live for fora do horário comercial (após 18h ou fins de semana), agende a entrega para o DIA SEGUINTE.
- Faça o cliente CONFIRMAR que vai ficar com o produto e combine horário de entrega.
- Use save_customer_data com delivery_method="local_delivery".

### Boleto Bancário
- NÃO oferecemos boleto por padrão. Se o cliente pedir, explique que normalmente não trabalhamos com boleto por conta da demora na compensação.
- MAS se o cliente GARANTIR que vai pagar no dia seguinte, aceite.
- Antes de gerar o boleto, colete TODOS os dados (nome, CPF, email, endereço).
- Use generate_boleto para criar o boleto no Mercado Pago.
- Use advance_stage para "aguardando_boleto".
- O boleto vence no dia seguinte.

### Pagamento Futuro ("quero pagar daqui X dias")
- NÃO separe produto para pagamento futuro.
- Explique educadamente mas com FIRMEZA: "Como informamos na live, os valores especiais são para pagamento no dia. Infelizmente já tivemos casos de clientes que pediam para separar e depois cancelavam, então precisamos manter essa política 😊"
- Pergunte se não consegue pagar hoje ou no máximo amanhã.
- Se insistir que não pode pagar no prazo:
  1. Peça EDUCADAMENTE que não faça pedido na live se não puder pagar no dia.
  2. Use mark_delayed_desistente com o motivo.
  3. A tool vai marcar o cliente e criar alerta para a apresentadora.
- Se esse cliente retornar em outra live, use notify_presenter com alert_type "returning_desistente".

### Política de Fotos
- NÃO envie fotos de produtos para evitar "leilão reverso" (cliente comparando preços).
- Diga que é o mesmo produto que apareceu na live.
- Ofereça pedir à apresentadora para mostrar novamente: use notify_presenter com alert_type "show_product_again".

### Novos Itens no Carrinho
- O cliente SÓ pode adicionar mais itens APÓS o pagamento do primeiro produto.
- Se pedir para adicionar antes de pagar, explique a política gentilmente.

### Cancelamento
- Primeiro entenda o motivo e tente reverter.
- Se insistir, use cancel_order. Peça educadamente que não repita.
${cancellationCount >= 2 ? '- ⚠️ ATENÇÃO: próximo cancelamento resultará em BAN da live. Avise o cliente CLARAMENTE.' : ''}
- Se o cliente já pagou outro pedido nessa live, o cancelamento é OK (não conta negativamente).

### Brinde e Frete Grátis
- Brinde: para pagamento PIX em até 20 minutos.
- Frete grátis: para compra recorrente no mesmo fim de semana.

## Tools disponíveis
- save_customer_data: salvar dados do cliente
- advance_stage: avançar etapa
- find_product: buscar produto (funciona com nomes aproximados)
- swap_product: trocar produto
- update_order_shipping: atualizar frete
- cancel_order: cancelar pedido
- notify_presenter: notificar apresentadora
- generate_boleto: gerar boleto bancário
- mark_delayed_desistente: marcar cliente que quer pagar no futuro

## Regras de Stage
- endereco/confirmar_endereco: extraia dados de endereço. Se completo → advance_stage para dados_pessoais.
- dados_pessoais: extraia nome/CPF/email (email opcional). Se tiver nome+CPF → advance_stage para forma_pagamento.
- forma_pagamento: PIX → advance_stage para aguardando_pix. Cartão → advance_stage para aguardando_cartao. Boleto → advance_stage para aguardando_boleto. Pagar na loja → advance_stage para aguardando_pagamento_loja.
- aguardando_pix: o PIX vem automático em outra mensagem. Só confirme.
- aguardando_cartao: envie o link de pagamento.
- aguardando_boleto: boleto gerado via generate_boleto.
- aguardando_pagamento_loja: aguardando retirada + pagamento presencial.`;

    // 6. Build messages for AI (with optional vision)
    const userContent: any[] = [];
    userContent.push({
      type: 'text',
      text: `Histórico da conversa:\n${conversationHistory}\n\nMensagem mais recente do cliente: "${combinedMessage}"`,
    });

    // If customer sent an image, include it for vision analysis
    if (recentMediaUrl) {
      userContent.push({
        type: 'image_url',
        image_url: { url: recentMediaUrl },
      });
      userContent.push({
        type: 'text',
        text: 'O cliente enviou esta imagem. Analise-a para identificar o produto e use find_product se necessário.',
      });
    }

    // 7. Tool calling loop (max 3 iterations)
    let messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent },
    ];

    let finalReply = '';
    let toolsExecuted: string[] = [];
    let stageAdvanced: string | null = null;

    const toolCtx = {
      supabase, supabaseUrl, supabaseKey,
      orderId, order, phone,
      customerId: order.customer_id,
      customerInstagram: customer?.instagram_handle || '',
      registration, eventId: order.event_id,
    };

    for (let turn = 0; turn < 3; turn++) {
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages,
          tools: liveteTools,
        }),
      });

      if (!aiResponse.ok) {
        const errBody = await aiResponse.text();
        console.error(`[livete-respond] AI error ${aiResponse.status}: ${errBody}`);
        return new Response(JSON.stringify({ handled: false, reason: 'ai_error' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const aiData = await aiResponse.json();
      const choice = aiData.choices?.[0];
      const assistantMessage = choice?.message;

      if (!assistantMessage) break;

      // Check if AI wants to call tools
      const toolCalls = assistantMessage.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls — this is the final reply
        finalReply = assistantMessage.content || '';
        break;
      }

      // Execute tool calls
      messages.push(assistantMessage); // Add assistant message with tool_calls

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        let fnArgs: Record<string, any> = {};
        try {
          fnArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          fnArgs = {};
        }

        console.log(`[livete-respond] Tool call: ${fnName}(${JSON.stringify(fnArgs).slice(0, 100)})`);
        toolsExecuted.push(fnName);

        const result = await executeToolCall(fnName, fnArgs, toolCtx);

        if (fnName === 'advance_stage' && result.success) {
          stageAdvanced = fnArgs.next_stage;
        }

        // Refresh registration data if save_customer_data was called
        if (fnName === 'save_customer_data' && result.success) {
          const { data: freshReg } = await supabase
            .from('customer_registrations')
            .select('*')
            .eq('order_id', orderId)
            .maybeSingle();
          if (freshReg) toolCtx.registration = freshReg;
        }

        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }

      // If AI also included text content alongside tool calls, capture it
      if (assistantMessage.content) {
        finalReply = assistantMessage.content;
      }
    }

    // Fallback if no reply
    if (!finalReply) {
      finalReply = 'Desculpe, tive um probleminha aqui. Pode repetir? 😅';
    }

    // ─── TYPING DELAY ───
    const delay = typingDelay(finalReply);
    console.log(`[livete-respond] Typing delay: ${delay}ms, tools: [${toolsExecuted.join(', ')}]`);
    await sleep(delay);

    // 8. Send reply via WhatsApp
    const sendNumberId = whatsappNumberId || session.whatsapp_number_id;

    async function sendWhatsApp(message: string) {
      if (!sendNumberId) return;
      const { data: wnData } = await supabase
        .from('whatsapp_numbers')
        .select('provider, phone_number_id')
        .eq('id', sendNumberId)
        .single();

      if (wnData?.provider === 'meta' && wnData?.phone_number_id) {
        await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, message, whatsappNumberId: sendNumberId }),
        });
      } else {
        await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, message, whatsapp_number_id: sendNumberId }),
        });
      }

      await supabase.from('whatsapp_messages').insert({
        phone, message, direction: 'outgoing', status: 'sent',
        whatsapp_number_id: sendNumberId,
      });
    }

    await sendWhatsApp(finalReply);

    // 9. If stage advanced to aguardando_pix, generate PIX inline
    const effectiveStage = stageAdvanced || currentStage;

    if (stageAdvanced === 'aguardando_pix') {
      console.log(`[livete-respond] Generating inline PIX for order ${orderId}`);

      const reg = toolCtx.registration || {};
      const payerData: Record<string, any> = {};
      if (reg.email) payerData.email = reg.email;
      if (reg.full_name) payerData.firstName = (reg.full_name || '').split(' ')[0];
      if (reg.cpf) payerData.cpf = reg.cpf;

      try {
        const pixResp = await fetch(`${supabaseUrl}/functions/v1/mercadopago-create-pix`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, payer: payerData }),
        });

        const pixData = await pixResp.json();

        if (pixData?.qrCode) {
          await sleep(3000);
          await sendWhatsApp(`💰 *Aqui está o PIX copia e cola!*\n\nValor: *R$ ${total.toFixed(2)}*\n\nCopie o código abaixo e cole no app do seu banco 👇`);
          await sleep(1500);
          await sendWhatsApp(pixData.qrCode);
          await sleep(1500);
          await sendWhatsApp(`⏰ O código expira em 30 minutos. Assim que o pagamento for confirmado, te aviso aqui! 😊`);
        } else {
          console.error('[livete-respond] PIX generation failed:', pixData);
          await sleep(2000);
          await sendWhatsApp(`Tive um probleminha ao gerar o PIX 😅 Mas não se preocupe, vou tentar novamente. Pode aguardar?`);
        }
      } catch (pixErr) {
        console.error('[livete-respond] PIX error:', pixErr);
        await sleep(2000);
        await sendWhatsApp(`Ops, tive uma dificuldade técnica ao gerar o PIX. Vou acionar nossa equipe! 🙏`);
      }
    }

    // 9b. If stage advanced to aguardando_boleto, send boleto info
    if (stageAdvanced === 'aguardando_boleto') {
      // The boleto was already generated by the generate_boleto tool during tool calling.
      // Check if we have boleto data from the tool execution
      console.log(`[livete-respond] Boleto stage reached for order ${orderId}`);
      // Boleto URL and barcode are sent as part of the AI's response after generate_boleto tool
    }

    // 10. Update session
    await supabase.from('automation_ai_sessions').update({
      messages_sent: (session.messages_sent || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', session.id);

    // 11. Log
    const responseTime = Date.now() - startTime;
    await supabase.from('ai_conversation_logs').insert({
      order_id: orderId,
      phone,
      stage: effectiveStage,
      message_in: combinedMessage,
      message_out: finalReply,
      ai_decision: stageAdvanced ? `stage_${currentStage}_to_${stageAdvanced}` : `stage_${currentStage}_hold`,
      tool_called: toolsExecuted.length > 0 ? toolsExecuted.join(',') : 'livete-respond',
      tool_params: toolsExecuted.length > 0 ? { tools: toolsExecuted } : null,
      response_time_ms: responseTime,
      provider: 'lovable-gateway',
    });

    console.log(`[livete-respond] Done: order=${orderId}, stage=${currentStage}→${effectiveStage}, tools=[${toolsExecuted.join(',')}], time=${responseTime}ms`);

    return new Response(JSON.stringify({
      handled: true, orderId,
      stage: effectiveStage, previousStage: currentStage,
      toolsUsed: toolsExecuted, responseTime,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[livete-respond] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
