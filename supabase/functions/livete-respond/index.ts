import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/** Calculate a human-like typing delay based on message length */
function typingDelay(text: string): number {
  // ~40 chars/sec typing speed, min 2s, max 12s
  const chars = text.length;
  const seconds = Math.max(2, Math.min(12, chars / 40));
  // Add slight randomness (±20%)
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

    const { phone, messageText, whatsappNumberId } = await req.json();
    if (!phone || !messageText) {
      return new Response(JSON.stringify({ error: 'phone and messageText required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[livete-respond] phone=${phone}, msg="${messageText.slice(0, 80)}"`);

    // ─── DEBOUNCE: wait for customer to finish typing ───
    // Wait 4 seconds, then check if more messages arrived
    await sleep(4000);

    // Check the latest incoming message for this phone
    const { data: latestMsgs } = await supabase
      .from('whatsapp_messages')
      .select('message, created_at')
      .eq('phone', phone)
      .eq('direction', 'incoming')
      .order('created_at', { ascending: false })
      .limit(1);

    const latestMsg = latestMsgs?.[0];
    if (latestMsg && latestMsg.message !== messageText) {
      // A newer message arrived — skip this one, the newer webhook will handle it
      console.log(`[livete-respond] Skipping: newer message detected for ${phone}`);
      return new Response(JSON.stringify({ handled: false, reason: 'debounced' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Collect all recent messages from customer in the last 30 seconds (fragmented messages)
    const thirtySecsAgo = new Date(Date.now() - 30000).toISOString();
    const { data: recentMsgs } = await supabase
      .from('whatsapp_messages')
      .select('message')
      .eq('phone', phone)
      .eq('direction', 'incoming')
      .gte('created_at', thirtySecsAgo)
      .order('created_at', { ascending: true });

    // Combine fragmented messages into one
    const combinedMessage = (recentMsgs && recentMsgs.length > 1)
      ? recentMsgs.map(m => m.message).filter(Boolean).join('\n')
      : messageText;

    if (recentMsgs && recentMsgs.length > 1) {
      console.log(`[livete-respond] Combined ${recentMsgs.length} fragmented messages for ${phone}`);
    }

    // 1. Check for active AI session
    const { data: session } = await supabase
      .from('automation_ai_sessions')
      .select('*')
      .eq('phone', phone)
      .eq('is_active', true)
      .maybeSingle();

    if (!session || !session.prompt?.startsWith('livete_checkout:')) {
      console.log(`[livete-respond] No active livete session for ${phone}`);
      return new Response(JSON.stringify({ handled: false, reason: 'no_active_session' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const orderId = session.prompt.replace('livete_checkout:', '');

    // 2. Check if AI is paused for this order
    const { data: order } = await supabase
      .from('orders')
      .select('id, event_id, customer_id, products, stage, stage_atendimento, ai_paused, shipping_cost, free_shipping, discount_type, discount_value, cart_link, delivery_method')
      .eq('id', orderId)
      .single();

    if (!order) {
      console.error(`[livete-respond] Order ${orderId} not found`);
      return new Response(JSON.stringify({ handled: false, reason: 'order_not_found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (order.ai_paused) {
      console.log(`[livete-respond] AI paused for order ${orderId}`);
      return new Response(JSON.stringify({ handled: false, reason: 'ai_paused' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Get customer info
    const { data: customer } = await supabase
      .from('customers')
      .select('id, instagram_handle, whatsapp')
      .eq('id', order.customer_id)
      .single();

    // 4. Get existing registration data (if any)
    const { data: registration } = await supabase
      .from('customer_registrations')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    // 5. Load conversation history (last 20 messages)
    const { data: history } = await supabase
      .from('whatsapp_messages')
      .select('message, direction, created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(20);

    const conversationHistory = (history || []).reverse().map((m: any) =>
      `${m.direction === 'outgoing' ? 'Livete' : 'Cliente'}: ${m.message}`
    ).join('\n');

    // 6. Load knowledge base
    const { data: kb } = await supabase
      .from('ai_knowledge_base')
      .select('category, title, content')
      .eq('is_active', true);

    const knowledgeText = (kb || []).map((k: any) =>
      `[${k.category}] ${k.title}: ${k.content}`
    ).join('\n');

    // 7. Calculate order totals for context
    const products = (order.products as any[]) || [];
    const subtotal = products.reduce((sum: number, p: any) =>
      sum + (Number(p.price || 0) * Number(p.quantity || 1)), 0
    );
    let discountAmount = 0;
    if (order.discount_value && Number(order.discount_value) > 0) {
      if (order.discount_type === 'fixed') discountAmount = Number(order.discount_value);
      else if (order.discount_type === 'percentage') discountAmount = subtotal * (Number(order.discount_value) / 100);
    }
    const total = Math.max(0, subtotal - discountAmount);

    const productsSummary = products.map((p: any) =>
      `${p.quantity || 1}x ${p.title}${p.variant ? ` (${p.variant})` : ''} — R$${Number(p.price || 0).toFixed(2)}`
    ).join(', ');

    // 8. Build current data context
    const currentStage = order.stage_atendimento || 'endereco';
    const regData = registration ? {
      nome: registration.full_name || '',
      cpf: registration.cpf || '',
      email: registration.email || '',
      cep: registration.cep || '',
      endereco: registration.address || '',
      numero: registration.address_number || '',
      complemento: registration.complement || '',
      bairro: registration.neighborhood || '',
      cidade: registration.city || '',
      estado: registration.state || '',
    } : {};

    // 9. Call AI via Lovable Gateway
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('[livete-respond] LOVABLE_API_KEY not set');
      return new Response(JSON.stringify({ handled: false, reason: 'no_api_key' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `Você é a Livete, atendente da Banana Calçados no WhatsApp. Converse como uma pessoa real — simpática, leve e direta. Nada de parecer robô.

## Como falar
- Frases CURTAS. Máximo 2-3 linhas por mensagem quando estiver respondendo perguntas ou confirmando algo simples.
- Mensagens maiores SÓ quando precisar listar informações (resumo do pedido, endereço, etc).
- Use emojis com moderação — 1 ou 2 por mensagem, no máximo.
- Evite repetir o nome do cliente toda hora. Use só de vez em quando pra soar natural.
- Nunca fale como manual de instrução. Fale como vendedora que tá no WhatsApp mesmo.
- SEMPRE termine com uma pergunta pro cliente, mas de forma natural — não precisa ser formal.
- Nunca invente informação. Use só o que sabe.
- Não repita perguntas que o cliente já respondeu.

## Exemplos de tom certo vs errado
❌ "Perfeito, Matthews! 😊 Seu endereço de entrega está confirmado: Rua Afonso Pena, nº 3473, Centro, Governador Valadares/MG, CEP: 35010002. Assim que o pagamento for confirmado, seu pedido será enviado para este local. Qual forma de pagamento você prefere: PIX (pagamento instantâneo) ou Cartão de Crédito (em até 3x sem juros)? 💳"
✅ "Anotado! Vou mandar pra esse endereço mesmo 📦 Como prefere pagar? PIX ou cartão (até 3x sem juros)?"

❌ "Entendi, Matthews! Compreendo que seria mais prático. 😊 A chave PIX é gerada automaticamente pelo sistema..."
✅ "Claro! Já vou gerar o PIX pra você, me dá um instante 😉"

## Base de Conhecimento
${knowledgeText}

## Pedido Atual
- Produtos: ${productsSummary}
- Subtotal: R$${subtotal.toFixed(2)}
${discountAmount > 0 ? `- Desconto: -R$${discountAmount.toFixed(2)}` : ''}
- Total: R$${total.toFixed(2)}
- Frete grátis: ${order.free_shipping ? 'Sim' : 'Não'}

## Dados já coletados
${JSON.stringify(regData, null, 2)}

## Etapa Atual: ${currentStage}

## Fluxo (siga na ordem):
1. **endereco** — Pegar endereço completo. Se falar "retirada na loja", aceite.
2. **confirmar_endereco** — Confirmar endereço salvo.
3. **dados_pessoais** — Pegar Nome Completo, CPF e E-mail.
4. **forma_pagamento** — PIX ou Cartão (até 3x sem juros).
5. **aguardando_pix** — PIX será gerado automaticamente. Só avise que tá gerando.
6. **aguardando_cartao** — Envie o link de pagamento: ${order.cart_link || 'sem link'}
7. **pago** — Pagamento confirmado.

## Regras por etapa
- **endereco/confirmar_endereco**: extraia dados do endereço. Se completo, vá pra dados_pessoais. Se faltar algo, pergunte só o que falta.
- **dados_pessoais**: extraia nome/CPF/email. Pode pedir tudo junto. Se tiver tudo, vá pra forma_pagamento.
- **forma_pagamento**: PIX → aguardando_pix (avise que vai mandar o código). Cartão → aguardando_cartao.
- **aguardando_pix**: o PIX vem automático em outra mensagem. Só confirme.

## Resposta (JSON obrigatório):
{
  "reply": "sua mensagem natural pro cliente",
  "next_stage": "etapa_atual_ou_proxima",
  "extracted_data": {
    "full_name": "", "cpf": "", "email": "",
    "cep": "", "address": "", "address_number": "",
    "complement": "", "neighborhood": "", "city": "", "state": "",
    "delivery_method": "shipping ou pickup",
    "payment_method": "pix ou cartao"
  }
}
Retorne SOMENTE o JSON.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Histórico da conversa:\n${conversationHistory}\n\nMensagem mais recente do cliente: "${combinedMessage}"` },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errBody = await aiResponse.text();
      console.error(`[livete-respond] AI error ${aiResponse.status}: ${errBody}`);
      return new Response(JSON.stringify({ handled: false, reason: 'ai_error', detail: errBody }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiResponse.json();
    const aiText = aiData.choices?.[0]?.message?.content || '';
    console.log(`[livete-respond] AI raw: ${aiText.slice(0, 200)}`);

    // Parse JSON response
    let parsed: { reply: string; next_stage: string; extracted_data: Record<string, string> };
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('[livete-respond] Failed to parse AI response:', parseErr, aiText);
      parsed = { reply: aiText, next_stage: currentStage, extracted_data: {} };
    }

    const { reply, next_stage, extracted_data } = parsed;

    // 10. Save/update customer_registrations with extracted data
    if (extracted_data && Object.values(extracted_data).some(v => v && v.length > 0)) {
      const upsertData: Record<string, any> = {
        order_id: orderId,
        whatsapp: phone,
        instagram_handle: customer?.instagram_handle || '',
      };

      if (extracted_data.full_name) upsertData.full_name = extracted_data.full_name;
      if (extracted_data.cpf) upsertData.cpf = extracted_data.cpf;
      if (extracted_data.email) upsertData.email = extracted_data.email;
      if (extracted_data.cep) upsertData.cep = extracted_data.cep;
      if (extracted_data.address) upsertData.address = extracted_data.address;
      if (extracted_data.address_number) upsertData.address_number = extracted_data.address_number;
      if (extracted_data.complement) upsertData.complement = extracted_data.complement;
      if (extracted_data.neighborhood) upsertData.neighborhood = extracted_data.neighborhood;
      if (extracted_data.city) upsertData.city = extracted_data.city;
      if (extracted_data.state) upsertData.state = extracted_data.state;

      if (registration) {
        const updateFields: Record<string, any> = {};
        for (const [key, val] of Object.entries(upsertData)) {
          if (key !== 'order_id' && key !== 'whatsapp' && key !== 'instagram_handle' && val) {
            updateFields[key] = val;
          }
        }
        if (Object.keys(updateFields).length > 0) {
          updateFields.updated_at = new Date().toISOString();
          await supabase.from('customer_registrations').update(updateFields).eq('id', registration.id);
          console.log(`[livete-respond] Updated registration ${registration.id}:`, Object.keys(updateFields));
        }
      } else {
        const insertData = {
          order_id: orderId,
          customer_id: order.customer_id,
          whatsapp: phone,
          full_name: extracted_data.full_name || '',
          cpf: extracted_data.cpf || '',
          email: extracted_data.email || '',
          cep: extracted_data.cep || '',
          address: extracted_data.address || '',
          address_number: extracted_data.address_number || '',
          neighborhood: extracted_data.neighborhood || '',
          city: extracted_data.city || '',
          state: extracted_data.state || '',
          status: 'pending',
        };
        const { error: insertErr } = await supabase.from('customer_registrations').insert(insertData);
        if (insertErr) {
          console.error('[livete-respond] Error inserting registration:', insertErr);
        } else {
          console.log('[livete-respond] Created new registration for order', orderId);
        }
      }

      // Update delivery method on order if extracted
      if (extracted_data.delivery_method) {
        const isPickup = extracted_data.delivery_method === 'pickup';
        await supabase.from('orders').update({
          delivery_method: extracted_data.delivery_method,
          is_pickup: isPickup,
          is_delivery: !isPickup,
        }).eq('id', orderId);
      }
    }

    // 11. Update stage_atendimento + auto-move Kanban card
    if (next_stage && next_stage !== currentStage) {
      await supabase.rpc('update_order_stage', {
        p_order_id: orderId,
        p_stage: next_stage,
      });
      console.log(`[livete-respond] Stage: ${currentStage} → ${next_stage}`);

      // Auto-move Kanban card based on AI stage
      if (next_stage === 'aguardando_pix' || next_stage === 'aguardando_cartao') {
        await supabase.from('orders').update({ stage: 'awaiting_payment' }).eq('id', orderId);
        console.log(`[livete-respond] Kanban card moved to awaiting_payment`);
      }
    }

    // ─── HUMAN-LIKE TYPING DELAY ───
    const delay = typingDelay(reply);
    console.log(`[livete-respond] Typing delay: ${delay}ms for ${reply.length} chars`);
    await sleep(delay);

    // 12. Send reply via WhatsApp
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

      // Save outgoing message
      await supabase.from('whatsapp_messages').insert({
        phone, message, direction: 'outgoing', status: 'sent',
        whatsapp_number_id: sendNumberId,
      });
    }

    // Send the AI reply
    await sendWhatsApp(reply);

    // 13. If stage advanced to aguardando_pix, generate and send PIX inline
    if (next_stage === 'aguardando_pix') {
      console.log(`[livete-respond] Generating inline PIX for order ${orderId}, total R$${total.toFixed(2)}`);
      
      // Build payer data from registration
      const reg = registration || extracted_data || {};
      const payerData: Record<string, any> = {};
      if (reg.email || extracted_data?.email) payerData.email = reg.email || extracted_data?.email;
      if (reg.full_name || extracted_data?.full_name) payerData.firstName = (reg.full_name || extracted_data?.full_name || '').split(' ')[0];
      if (reg.cpf || extracted_data?.cpf) payerData.cpf = reg.cpf || extracted_data?.cpf;

      try {
        const pixResp = await fetch(`${supabaseUrl}/functions/v1/mercadopago-create-pix`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, payer: payerData }),
        });

        const pixData = await pixResp.json();

        if (pixData?.qrCode) {
          // Wait before sending the PIX intro
          await sleep(3000);

          const pixIntro = `💰 *Aqui está o PIX copia e cola!*\n\nValor: *R$ ${total.toFixed(2)}*\n\nCopie o código abaixo e cole no app do seu banco 👇`;
          await sendWhatsApp(pixIntro);

          // Send the PIX code alone so the client can easily copy it
          await sleep(1500);
          await sendWhatsApp(pixData.qrCode);

          // Send expiration notice
          await sleep(1500);
          await sendWhatsApp(`⏰ O código expira em 30 minutos. Assim que o pagamento for confirmado, te aviso aqui! 😊`);

          console.log(`[livete-respond] PIX code sent in separate messages to ${phone}`);
        } else {
          console.error('[livete-respond] PIX generation failed:', pixData);
          await sleep(2000);
          await sendWhatsApp(`Tive um probleminha ao gerar o PIX 😅 Mas não se preocupe, vou tentar novamente. Pode aguardar um instante?`);
        }
      } catch (pixErr) {
        console.error('[livete-respond] PIX error:', pixErr);
        await sleep(2000);
        await sendWhatsApp(`Ops, tive uma dificuldade técnica ao gerar o PIX. Vou acionar nossa equipe pra resolver rapidinho! 🙏`);
      }
    }

    // 14. Update session message count
    await supabase.from('automation_ai_sessions').update({
      messages_sent: (session.messages_sent || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', session.id);

    // 15. Log to ai_conversation_logs
    const responseTime = Date.now() - startTime;
    await supabase.from('ai_conversation_logs').insert({
      order_id: orderId,
      phone,
      stage: next_stage || currentStage,
      message_in: combinedMessage,
      message_out: reply,
      ai_decision: `stage_${currentStage}_to_${next_stage}`,
      tool_called: 'livete-respond',
      tool_params: extracted_data && Object.keys(extracted_data).length > 0 ? extracted_data : null,
      response_time_ms: responseTime,
      provider: 'lovable-gateway',
    });

    console.log(`[livete-respond] Done: order=${orderId}, stage=${currentStage}→${next_stage}, time=${responseTime}ms`);

    return new Response(JSON.stringify({
      handled: true,
      orderId,
      stage: next_stage,
      previousStage: currentStage,
      extractedData: extracted_data,
      responseTime,
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
