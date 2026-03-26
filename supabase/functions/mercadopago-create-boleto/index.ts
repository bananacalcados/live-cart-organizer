import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { orderId, payer } = await req.json();
    if (!orderId) throw new Error('orderId required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const mpToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
    if (!mpToken) throw new Error('MERCADOPAGO_ACCESS_TOKEN not configured');

    // Load order to get total
    const { data: order } = await supabase
      .from('orders')
      .select('id, products, free_shipping, shipping_cost, discount_type, discount_value')
      .eq('id', orderId)
      .single();

    if (!order) throw new Error('Order not found');

    const products = (order.products as any[]) || [];
    const subtotal = products.reduce((s: number, p: any) =>
      s + (Number(p.price || 0) * Number(p.quantity || 1)), 0);

    let discount = 0;
    if (order.discount_value && Number(order.discount_value) > 0) {
      if (order.discount_type === 'fixed') discount = Number(order.discount_value);
      else if (order.discount_type === 'percentage') discount = subtotal * (Number(order.discount_value) / 100);
    }

    const shipping = order.free_shipping ? 0 : Number(order.shipping_cost || 0);
    const total = Math.max(0, subtotal - discount + shipping);

    if (total <= 0) throw new Error('Total must be greater than zero');

    // Create boleto via Mercado Pago
    const payerData: any = {
      email: payer?.email || 'cliente@banana.com',
      first_name: payer?.firstName || 'Cliente',
      last_name: payer?.lastName || 'Banana',
    };

    if (payer?.cpf) {
      payerData.identification = {
        type: 'CPF',
        number: payer.cpf.replace(/\D/g, ''),
      };
    }

    // Set due date to next business day
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    // Skip weekends
    if (dueDate.getDay() === 0) dueDate.setDate(dueDate.getDate() + 1);
    if (dueDate.getDay() === 6) dueDate.setDate(dueDate.getDate() + 2);

    const mpResp = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mpToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `boleto-${orderId}-${Date.now()}`,
      },
      body: JSON.stringify({
        transaction_amount: Math.round(total * 100) / 100,
        description: `Pedido Live Banana - ${products.map((p: any) => p.title).join(', ').slice(0, 200)}`,
        payment_method_id: 'bolbradesco',
        payer: payerData,
        date_of_expiration: dueDate.toISOString(),
        notification_url: `${supabaseUrl}/functions/v1/payment-webhook`,
        external_reference: orderId,
      }),
    });

    const mpData = await mpResp.json();
    console.log('[mercadopago-create-boleto] Response status:', mpResp.status);

    if (!mpResp.ok) {
      console.error('[mercadopago-create-boleto] Error:', JSON.stringify(mpData));
      throw new Error(`Mercado Pago error: ${mpData.message || mpResp.status}`);
    }

    const boletoUrl = mpData.transaction_details?.external_resource_url;
    const barcode = mpData.barcode?.content;

    // Update order with MP payment ID
    await supabase.from('orders').update({
      mercadopago_payment_id: String(mpData.id),
      updated_at: new Date().toISOString(),
    }).eq('id', orderId);

    return new Response(JSON.stringify({
      success: true,
      paymentId: mpData.id,
      boletoUrl,
      barcode,
      dueDate: dueDate.toISOString().split('T')[0],
      total,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[mercadopago-create-boleto] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
