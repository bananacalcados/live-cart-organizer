import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'orderId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, event_id, customer_id, products, stage, stage_atendimento, shipping_cost, free_shipping, delivery_method, cart_link, discount_type, discount_value')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      console.error('[livete-start] Order not found:', orderId, orderErr);
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, instagram_handle, whatsapp')
      .eq('id', order.customer_id)
      .single();

    if (!customer?.whatsapp) {
      console.error('[livete-start] Customer has no WhatsApp:', order.customer_id);
      return new Response(JSON.stringify({ error: 'Customer has no WhatsApp' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawPhone = customer.whatsapp.replace(/\D/g, '');
    const phone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone;

    let whatsappNumberId: string | null = null;
    let metaPhoneNumberId: string | null = null;

    if (order.event_id) {
      const { data: eventData } = await supabase
        .from('events')
        .select('whatsapp_number_id')
        .eq('id', order.event_id)
        .single();

      if (eventData?.whatsapp_number_id) {
        whatsappNumberId = eventData.whatsapp_number_id;

        const { data: wnData } = await supabase
          .from('whatsapp_numbers')
          .select('id, label, provider, phone_number_id')
          .eq('id', whatsappNumberId)
          .single();

        if (wnData?.provider === 'meta' && wnData?.phone_number_id) {
          metaPhoneNumberId = wnData.phone_number_id;
        }
      }
    }

    let savedAddress: Record<string, string> | null = null;
    if (customer.id) {
      const { data: addrData } = await supabase.rpc('get_customer_last_address', {
        p_customer_id: customer.id,
      });
      if (addrData && typeof addrData === 'object' && (addrData as any).cep) {
        savedAddress = addrData as Record<string, string>;
      }
    }

    const products = (order.products as any[]) || [];
    const productLines = products.map((p: any) =>
      `${p.quantity || 1}x ${p.title}${p.variant ? ` (${p.variant})` : ''} — R$${Number(p.price || 0).toFixed(2)}`
    ).join('\n');

    const subtotal = products.reduce((sum: number, p: any) =>
      sum + (Number(p.price || 0) * Number(p.quantity || 1)), 0
    );

    let discountAmount = 0;
    if (order.discount_value && Number(order.discount_value) > 0) {
      if (order.discount_type === 'fixed') {
        discountAmount = Number(order.discount_value);
      } else if (order.discount_type === 'percentage') {
        discountAmount = subtotal * (Number(order.discount_value) / 100);
      }
    }
    const total = Math.max(0, subtotal - discountAmount);

    let pricingBlock = `💰 Subtotal: R$${subtotal.toFixed(2)}`;
    if (discountAmount > 0) {
      pricingBlock += `\n🏷️ Desconto: -R$${discountAmount.toFixed(2)}`;
      pricingBlock += `\n✅ *Total: R$${total.toFixed(2)}*`;
    }

    const igHandle = customer.instagram_handle || 'Cliente';
    const igName = igHandle.startsWith('@') ? igHandle : `@${igHandle}`;

    const checkoutLink = order.cart_link || `https://checkout.bananacalcados.com.br/checkout/order/${orderId}`;

    // 5 variações de bloco A (abertura) — todas em tom direto, casual
    const openings = [
      `Oii ${igName}! Já estamos separando seu pedido por aqui 😁 Acabei de criar o link do seu carrinho com tudo certinho (inclusive as fotos das peças).\n\nÉ só clicar abaixo pra finalizar 👇`,
      `Eaee ${igName} 🙌 Seu pedido já tá sendo separado! Montei o link do carrinho com todos os itens e fotos pra você conferir.\n\nClica aqui embaixo pra abrir 👇`,
      `Oii ${igName} 😊 Tudo certo por aqui, já comecei a separar seu pedido. Criei o link do carrinho com fotos e valores pra ficar fácil de conferir.\n\nDá uma olhada no link aqui embaixo 👇`,
      `Oii ${igName}! Aqui é da Banana 🍌 Já tô separando seu pedido. Te mandei o link do carrinho com tudo discriminado (fotos, valores e quantidade).\n\nSó abrir aí embaixo 👇`,
      `Eaee ${igName} 💛 Pedido confirmado por aqui, já comecei a separar! Gerei o link do seu carrinho com fotos e detalhes pra você revisar antes de fechar.\n\nÉ só clicar abaixo 👇`,
    ];

    // 5 variações de bloco C (endereço) — TODAS terminam com pergunta (regra)
    const addressKnownVariants = (addr: string) => [
      `Pra eu já ir agilizando o envio, o endereço ainda é este?\n📍 ${addr}\n\nPosso confirmar?`,
      `Aproveitando: o endereço de entrega continua sendo este aqui?\n📍 ${addr}\n\nConfirma pra mim?`,
      `Pra adiantar a expedição, esse endereço ainda tá certo?\n📍 ${addr}\n\nPosso seguir com ele?`,
      `Antes de fechar, só pra conferir — o envio continua nesse endereço?\n📍 ${addr}\n\nTá tudo certo aí?`,
      `Só uma confirmação rapidinha: posso enviar pra esse endereço mesmo?\n📍 ${addr}\n\nTá ok ou prefere atualizar?`,
    ];

    const addressUnknownVariants = [
      `Pra eu já ir agilizando o envio, pode me passar seu endereço completo por aqui?`,
      `Aproveitando, qual o endereço pra entrega? Pode me mandar por aqui mesmo?`,
      `Pra adiantar a expedição, me passa seu endereço completinho aqui?`,
      `Antes de fechar, qual endereço você quer usar pra entrega?`,
      `Só falta o endereço — pode me enviar o seu completo por aqui?`,
    ];

    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

    const blockA = pick(openings);
    const blockB = checkoutLink;
    let blockC: string;
    let initialStage: string;

    if (savedAddress) {
      const addrStr = [
        savedAddress.address,
        savedAddress.address_number ? `nº ${savedAddress.address_number}` : '',
        savedAddress.complement || '',
        savedAddress.neighborhood || '',
        `${savedAddress.city || ''}/${savedAddress.state || ''}`,
        savedAddress.cep ? `CEP: ${savedAddress.cep}` : '',
      ].filter(Boolean).join(', ');
      blockC = pick(addressKnownVariants(addrStr));
      initialStage = 'confirmar_endereco';
    } else {
      blockC = pick(addressUnknownVariants);
      initialStage = 'endereco';
    }

    const messageParts = [blockA, blockB, blockC];
    const firstMessage = messageParts.join('\n\n'); // só pra log/dedupe

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const sessionPayload = {
      phone,
      flow_id: null,
      is_active: true,
      prompt: `livete_checkout:${orderId}`,
      expires_at: expiresAt,
      whatsapp_number_id: whatsappNumberId,
      max_messages: 50,
      messages_sent: 1,
      updated_at: new Date().toISOString(),
    };

    const { error: sessionErr } = await supabase
      .from('automation_ai_sessions')
      .upsert(sessionPayload, { onConflict: 'phone' });

    if (sessionErr) {
      console.error('[livete-start] Failed to upsert AI session:', sessionErr);
      return new Response(JSON.stringify({ error: 'Failed to create AI session' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.rpc('update_order_stage', {
      p_order_id: orderId,
      p_stage: initialStage,
    });
    await supabase.from('orders').update({ stage: 'contacted' }).eq('id', orderId);

    const recentThreshold = new Date(Date.now() - 15000).toISOString();
    let duplicateQuery = supabase
      .from('whatsapp_messages')
      .select('id, created_at')
      .eq('phone', phone)
      .eq('direction', 'outgoing')
      .ilike('message', `%já estamos separando seu pedido%`)
      .gte('created_at', recentThreshold)
      .order('created_at', { ascending: false })
      .limit(1);

    duplicateQuery = whatsappNumberId
      ? duplicateQuery.eq('whatsapp_number_id', whatsappNumberId)
      : duplicateQuery.is('whatsapp_number_id', null);

    const { data: recentDuplicate } = await duplicateQuery;
    const shouldSkipSend = Boolean(recentDuplicate && recentDuplicate.length > 0);

    if (shouldSkipSend) {
      console.log(`[livete-start] Duplicate start skipped for order ${orderId} / ${phone}`);
    } else {
      // ⚠️ ANTI-SPAM: Send ALL content as a SINGLE message to avoid WhatsApp ban.
      // Multiple rapid messages on first contact triggered spam detection and got the number banned.
      if (metaPhoneNumberId) {
        await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone,
            message: firstMessage,
            whatsappNumberId: whatsappNumberId,
          }),
        });
      } else {
        await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone,
            message: firstMessage,
            whatsapp_number_id: whatsappNumberId,
          }),
        });
      }

      // Log the unified message for history
      await supabase.from('whatsapp_messages').insert({
        phone,
        message: firstMessage,
        direction: 'outgoing',
        status: 'sent',
        whatsapp_number_id: whatsappNumberId,
      });
    }

    const responseTime = Date.now() - startTime;
    await supabase.from('ai_conversation_logs').insert({
      order_id: orderId,
      phone,
      stage: initialStage,
      message_out: shouldSkipSend ? null : firstMessage,
      ai_decision: shouldSkipSend ? 'start_skipped_duplicate' : (savedAddress ? 'confirm_existing_address' : 'ask_new_address'),
      tool_called: 'livete-start-order',
      response_time_ms: responseTime,
      provider: 'system',
    });

    console.log(`[livete-start] Order ${orderId} → phone=${phone}, stage=${initialStage}, hasAddress=${!!savedAddress}, duplicateSkipped=${shouldSkipSend}, time=${responseTime}ms`);

    return new Response(JSON.stringify({
      success: true,
      phone,
      stage: initialStage,
      hasAddress: !!savedAddress,
      duplicateSkipped: shouldSkipSend,
      responseTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[livete-start] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});