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

    // Messages sent as separate blocks
    const messageParts: string[] = [];

    messageParts.push(`Oii ${igName} já estamos separando seu pedido. Inclusive já criei o link do seu carrinho 😁\n\nNo link tem todas as informações do seu pedido, inclusive fotos. Só clicar e preencher pra finalizar a compra.\n\nSó clicar abaixo pra entrar 👇`);

    messageParts.push(checkoutLink);

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

      messageParts.push(`Pra eu ir agilizando seu pedido, o endereço pra envio ainda é este?\n📍 ${addrStr}\n\nPosso confirmar ou prefere atualizar?`);
      initialStage = 'confirmar_endereco';
    } else {
      messageParts.push(`Pra eu ir agilizando seu pedido, pode me passar seu endereço por aqui também? 😊`);
      initialStage = 'endereco';
    }

    const firstMessage = messageParts.join('\n\n');

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
      .eq('message', firstMessage)
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