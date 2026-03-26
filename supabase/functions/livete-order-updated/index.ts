import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function typingDelay(text: string): number {
  const chars = text.length;
  const seconds = Math.max(2, Math.min(10, chars / 40));
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

    const { orderId, changeType } = await req.json();
    // changeType: 'products_changed' | 'discount_changed' | 'shipping_changed'

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'orderId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Check if there's an active AI session for this order
    const { data: sessions } = await supabase
      .from('automation_ai_sessions')
      .select('*')
      .eq('is_active', true)
      .like('prompt', `livete_checkout:${orderId}`);

    const session = sessions?.[0];
    if (!session) {
      console.log(`[livete-order-updated] No active session for order ${orderId}`);
      return new Response(JSON.stringify({ handled: false, reason: 'no_active_session' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch order details
    const { data: order } = await supabase
      .from('orders')
      .select('id, products, stage, stage_atendimento, ai_paused, discount_type, discount_value, free_shipping, shipping_cost, cart_link, delivery_method')
      .eq('id', orderId)
      .single();

    if (!order || order.ai_paused) {
      return new Response(JSON.stringify({ handled: false, reason: order ? 'ai_paused' : 'order_not_found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Get customer name
    const { data: customer } = await supabase
      .from('customers')
      .select('instagram_handle')
      .eq('whatsapp', session.phone.startsWith('55') ? session.phone.slice(2) : session.phone)
      .maybeSingle();

    // Also try with full phone
    let customerName = customer?.instagram_handle || '';
    if (!customerName) {
      const { data: c2 } = await supabase
        .from('customers')
        .select('instagram_handle')
        .eq('whatsapp', session.phone)
        .maybeSingle();
      customerName = c2?.instagram_handle || 'Cliente';
    }
    if (customerName.startsWith('@')) customerName = customerName.slice(1);

    // 4. Calculate new totals
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
    ).join('\n');

    // 5. Build notification message
    let message = '';
    const currentStage = order.stage_atendimento || '';

    if (changeType === 'products_changed') {
      message = `Oi, ${customerName}! 😊 Vi que houve uma atualização no seu pedido! Aqui está o resumo atualizado:\n\n` +
        `${productsSummary}\n\n` +
        `💰 Subtotal: R$${subtotal.toFixed(2)}`;
      if (discountAmount > 0) {
        message += `\n🏷️ Desconto: -R$${discountAmount.toFixed(2)}`;
      }
      message += `\n✅ *Total: R$${total.toFixed(2)}*`;
    } else if (changeType === 'discount_changed') {
      message = `Oi, ${customerName}! 😊 O desconto do seu pedido foi atualizado!\n\n` +
        `💰 Subtotal: R$${subtotal.toFixed(2)}`;
      if (discountAmount > 0) {
        message += `\n🏷️ Desconto: -R$${discountAmount.toFixed(2)}`;
      }
      message += `\n✅ *Novo total: R$${total.toFixed(2)}*`;
    } else {
      message = `Oi, ${customerName}! 😊 Seu pedido foi atualizado!\n\n` +
        `${productsSummary}\n\n` +
        `✅ *Total: R$${total.toFixed(2)}*`;
    }

    // Add stage-appropriate follow-up
    if (currentStage === 'aguardando_pix') {
      message += `\n\nComo seu pedido mudou, vou gerar um novo código PIX pra você. Aguarde um instante! 🙏`;
    } else if (currentStage === 'aguardando_cartao') {
      message += `\n\nO link de pagamento por cartão foi atualizado com o novo valor. Pode conferir? 😊`;
    } else {
      message += `\n\nPodemos continuar de onde paramos?`;
    }

    // 6. Send via WhatsApp (with human-like delay)
    const delay = typingDelay(message);
    await sleep(delay);

    const sendNumberId = session.whatsapp_number_id;
    if (sendNumberId) {
      const { data: wnData } = await supabase
        .from('whatsapp_numbers')
        .select('provider, phone_number_id')
        .eq('id', sendNumberId)
        .single();

      if (wnData?.provider === 'meta' && wnData?.phone_number_id) {
        await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: session.phone, message, whatsappNumberId: sendNumberId }),
        });
      } else {
        await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: session.phone, message, whatsapp_number_id: sendNumberId }),
        });
      }

      // Save outgoing message
      await supabase.from('whatsapp_messages').insert({
        phone: session.phone, message, direction: 'outgoing', status: 'sent',
        whatsapp_number_id: sendNumberId,
      });
    }

    // 7. If was awaiting PIX, regenerate it
    if (currentStage === 'aguardando_pix') {
      try {
        const { data: registration } = await supabase
          .from('customer_registrations')
          .select('*')
          .eq('order_id', orderId)
          .maybeSingle();

        const payerData: Record<string, any> = {};
        if (registration?.email) payerData.email = registration.email;
        if (registration?.full_name) payerData.firstName = registration.full_name.split(' ')[0];
        if (registration?.cpf) payerData.cpf = registration.cpf;

        await sleep(3000);

        const pixResp = await fetch(`${supabaseUrl}/functions/v1/mercadopago-create-pix`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, payer: payerData }),
        });

        const pixData = await pixResp.json();

        if (pixData?.qrCode && sendNumberId) {
          const pixMessage = `💰 *Aqui está o novo PIX copia e cola!*\n\n` +
            `Valor: *R$ ${total.toFixed(2)}*\n\n` +
            `Copie o código abaixo e cole no app do seu banco:\n\n` +
            `${pixData.qrCode}\n\n` +
            `⏰ O código expira em 30 minutos. Assim que o pagamento for confirmado, te aviso aqui! 😊`;

          await sleep(2000);

          const { data: wnData } = await supabase
            .from('whatsapp_numbers')
            .select('provider, phone_number_id')
            .eq('id', sendNumberId)
            .single();

          if (wnData?.provider === 'meta' && wnData?.phone_number_id) {
            await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: session.phone, message: pixMessage, whatsappNumberId: sendNumberId }),
            });
          } else {
            await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: session.phone, message: pixMessage, whatsapp_number_id: sendNumberId }),
            });
          }

          await supabase.from('whatsapp_messages').insert({
            phone: session.phone, message: pixMessage, direction: 'outgoing', status: 'sent',
            whatsapp_number_id: sendNumberId,
          });

          console.log(`[livete-order-updated] New PIX sent for updated order ${orderId}`);
        }
      } catch (pixErr) {
        console.error('[livete-order-updated] PIX regeneration error:', pixErr);
      }
    }

    // 8. Log
    await supabase.from('ai_conversation_logs').insert({
      order_id: orderId,
      phone: session.phone,
      stage: currentStage,
      message_out: message,
      ai_decision: `order_updated_${changeType}`,
      tool_called: 'livete-order-updated',
      provider: 'system',
    });

    console.log(`[livete-order-updated] Notified ${session.phone} about ${changeType} on order ${orderId}`);

    return new Response(JSON.stringify({ handled: true, changeType }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[livete-order-updated] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
