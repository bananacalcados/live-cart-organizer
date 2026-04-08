import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function typingDelay(text: string): number {
  const chars = text.length;
  const seconds = Math.max(2, Math.min(8, chars / 40));
  return Math.round(seconds * (0.8 + Math.random() * 0.4) * 1000);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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

    // 1. Fetch order with products
    const { data: order } = await supabase
      .from('orders')
      .select('id, products, event_id, customer_id, is_paid, stage, free_shipping, shipping_cost, discount_type, discount_value, delivery_method')
      .eq('id', orderId)
      .single();

    if (!order) {
      console.log(`[livete-payment-confirmation] Order ${orderId} not found`);
      return new Response(JSON.stringify({ handled: false, reason: 'order_not_found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only for event orders (live commerce)
    if (!order.event_id) {
      console.log(`[livete-payment-confirmation] Order ${orderId} is not an event order, skipping`);
      return new Response(JSON.stringify({ handled: false, reason: 'not_event_order' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Get customer phone
    const { data: customer } = await supabase
      .from('customers')
      .select('whatsapp, instagram_handle')
      .eq('id', order.customer_id)
      .single();

    if (!customer?.whatsapp) {
      console.log(`[livete-payment-confirmation] No WhatsApp for customer of order ${orderId}`);
      return new Response(JSON.stringify({ handled: false, reason: 'no_whatsapp' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phone = customer.whatsapp.replace(/\D/g, '');
    const fullPhone = phone.startsWith('55') ? phone : `55${phone}`;

    // 3. Get customer name
    let customerName = customer.instagram_handle || '';
    if (customerName.startsWith('@')) customerName = customerName.slice(1);
    if (!customerName) customerName = 'Cliente';

    // 4. Build product confirmation list
    const products = (order.products as any[]) || [];
    if (products.length === 0) {
      console.log(`[livete-payment-confirmation] Order ${orderId} has no products`);
      return new Response(JSON.stringify({ handled: false, reason: 'no_products' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const productLines = products.map((p: any, i: number) => {
      const parts: string[] = [];
      parts.push(`*${i + 1}. ${p.title || 'Produto'}*`);
      if (p.variant) parts.push(`   📏 ${p.variant}`);
      if (p.color) parts.push(`   🎨 Cor: ${p.color}`);
      if (p.size) parts.push(`   👟 Tamanho: ${p.size}`);
      parts.push(`   🔢 Qtd: ${p.quantity || 1}`);
      return parts.join('\n');
    }).join('\n\n');

    // 5. Build confirmation message (direct, no fluff)
    const message = `Oi ${customerName}! Pagamento confirmado ✅\n\n` +
      `Confere os itens do seu pedido antes de enviar:\n\n` +
      `${productLines}\n\n` +
      `Tá tudo certo? Responde *SIM* pra confirmar ou me avisa se precisa corrigir algo 😊`;

    // 6. Find the WhatsApp number used for this event
    const { data: event } = await supabase
      .from('events')
      .select('whatsapp_number_id')
      .eq('id', order.event_id)
      .single();

    const sendNumberId = event?.whatsapp_number_id;
    if (!sendNumberId) {
      console.log(`[livete-payment-confirmation] No WhatsApp number for event of order ${orderId}`);
      return new Response(JSON.stringify({ handled: false, reason: 'no_whatsapp_number' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 7. Send with human-like delay
    await sleep(typingDelay(message));

    const { data: wnData } = await supabase
      .from('whatsapp_numbers')
      .select('provider, phone_number_id')
      .eq('id', sendNumberId)
      .single();

    if (wnData?.provider === 'meta' && wnData?.phone_number_id) {
      await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, message, whatsappNumberId: sendNumberId }),
      });
    } else {
      await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, message, whatsapp_number_id: sendNumberId }),
      });
    }

    // 8. Save outgoing message
    await supabase.from('whatsapp_messages').insert({
      phone: fullPhone,
      message,
      direction: 'outgoing',
      status: 'sent',
      whatsapp_number_id: sendNumberId,
    });

    // 9. Update order stage to confirmation pending
    await supabase.from('orders').update({
      stage_atendimento: 'aguardando_confirmacao_pedido',
    }).eq('id', orderId);

    // 10. Log
    await supabase.from('ai_conversation_logs').insert({
      order_id: orderId,
      phone: fullPhone,
      stage: 'aguardando_confirmacao_pedido',
      message_out: message,
      ai_decision: 'payment_confirmation_sent',
      tool_called: 'livete-payment-confirmation',
      provider: 'system',
    });

    console.log(`[livete-payment-confirmation] Sent confirmation to ${fullPhone} for order ${orderId}`);

    return new Response(JSON.stringify({ handled: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[livete-payment-confirmation] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
