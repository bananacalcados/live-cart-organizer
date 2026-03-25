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
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Fetch order with customer
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, event_id, customer_id, products, stage, shipping_cost, free_shipping, delivery_method, cart_link, discount_type, discount_value')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      console.error('[livete-start] Order not found:', orderId, orderErr);
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch customer
    const { data: customer } = await supabase
      .from('customers')
      .select('id, instagram_handle, whatsapp')
      .eq('id', order.customer_id)
      .single();

    if (!customer?.whatsapp) {
      console.error('[livete-start] Customer has no WhatsApp:', order.customer_id);
      return new Response(JSON.stringify({ error: 'Customer has no WhatsApp' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize phone
    const rawPhone = customer.whatsapp.replace(/\D/g, '');
    const phone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone;

    // 3. Fetch event config (whatsapp_number_id for sending)
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

        // Check if this is a Meta instance (has meta_phone_number_id)
        const { data: wnData } = await supabase
          .from('whatsapp_numbers')
          .select('id, label, meta_phone_number_id')
          .eq('id', whatsappNumberId)
          .single();

        if (wnData?.meta_phone_number_id) {
          metaPhoneNumberId = wnData.meta_phone_number_id;
        }
      }
    }

    // 4. Check if customer has saved address
    let savedAddress: Record<string, string> | null = null;
    if (customer.id) {
      const { data: addrData } = await supabase.rpc('get_customer_last_address', {
        p_customer_id: customer.id,
      });
      if (addrData && typeof addrData === 'object' && (addrData as any).cep) {
        savedAddress = addrData as Record<string, string>;
      }
    }

    // 5. Build product description
    const products = (order.products as any[]) || [];
    const productLines = products.map((p: any) =>
      `${p.quantity || 1}x ${p.title}${p.variant ? ` (${p.variant})` : ''} — R$${Number(p.price || 0).toFixed(2)}`
    ).join('\n');

    const subtotal = products.reduce((sum: number, p: any) =>
      sum + (Number(p.price || 0) * Number(p.quantity || 1)), 0
    );

    // 6. Build first message
    const igHandle = customer.instagram_handle || 'Cliente';
    const igName = igHandle.startsWith('@') ? igHandle : `@${igHandle}`;

    let firstMessage: string;
    let initialStage: string;

    if (savedAddress) {
      // Customer has address — ask to confirm
      const addrStr = [
        savedAddress.address,
        savedAddress.address_number ? `nº ${savedAddress.address_number}` : '',
        savedAddress.complement || '',
        savedAddress.neighborhood || '',
        `${savedAddress.city || ''}/${savedAddress.state || ''}`,
        savedAddress.cep ? `CEP: ${savedAddress.cep}` : '',
      ].filter(Boolean).join(', ');

      firstMessage = `Olá ${igName}! 😊 Já separamos seu pedido:\n\n` +
        `${productLines}\n\n` +
        `💰 Subtotal: R$${subtotal.toFixed(2)}\n\n` +
        `O endereço pra envio ainda é este?\n📍 ${addrStr}\n\n` +
        `Responde *sim* pra confirmar ou me manda o novo endereço completo!`;
      initialStage = 'confirmar_endereco';
    } else {
      // No address — ask for it
      firstMessage = `Olá ${igName}! 😊 Já separamos seu pedido:\n\n` +
        `${productLines}\n\n` +
        `💰 Subtotal: R$${subtotal.toFixed(2)}\n\n` +
        `Qual será o endereço completo pra envio? (Rua, número, bairro, cidade, estado e CEP)\n\n` +
        `Se preferir *retirar na loja*, é só me avisar! 😉`;
      initialStage = 'endereco';
    }

    // 7. Send message via Meta WhatsApp
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
      // Fallback to Z-API
      const { data: wnData } = await supabase
        .from('whatsapp_numbers')
        .select('zapi_instance_id, zapi_token, zapi_client_token')
        .eq('id', whatsappNumberId)
        .single();

      if (wnData) {
        await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone,
            message: firstMessage,
            instanceId: (wnData as any).zapi_instance_id,
            token: (wnData as any).zapi_token,
            clientToken: (wnData as any).zapi_client_token,
          }),
        });
      }
    }

    // 8. Save outgoing message to whatsapp_messages
    await supabase.from('whatsapp_messages').insert({
      phone,
      message: firstMessage,
      direction: 'outgoing',
      status: 'sent',
      whatsapp_number_id: whatsappNumberId,
    });

    // 9. Set stage_atendimento
    await supabase.rpc('update_order_stage', {
      p_order_id: orderId,
      p_stage: initialStage,
    });

    // 10. Create AI session for this phone
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h
    await supabase.from('automation_ai_sessions').upsert({
      phone,
      flow_id: null,
      is_active: true,
      prompt: `livete_checkout:${orderId}`,
      expires_at: expiresAt,
      whatsapp_number_id: whatsappNumberId,
      max_messages: 50,
      messages_sent: 1,
    }, { onConflict: 'phone' });

    // 11. Log
    const responseTime = Date.now() - startTime;
    await supabase.from('ai_conversation_logs').insert({
      order_id: orderId,
      phone,
      stage: initialStage,
      message_out: firstMessage,
      ai_decision: savedAddress ? 'confirm_existing_address' : 'ask_new_address',
      tool_called: 'livete-start-order',
      response_time_ms: responseTime,
      provider: 'system',
    });

    console.log(`[livete-start] Order ${orderId} → phone=${phone}, stage=${initialStage}, hasAddress=${!!savedAddress}, time=${responseTime}ms`);

    return new Response(JSON.stringify({
      success: true,
      phone,
      stage: initialStage,
      hasAddress: !!savedAddress,
      responseTime,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[livete-start] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
