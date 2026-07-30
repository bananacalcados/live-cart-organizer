// Envio MANUAL do template Meta configurado no evento (etapa MENSAGEM do wizard)
// para o WhatsApp da cliente de um pedido específico.
// Não altera etapa do pedido, não cria sessão de IA — apenas dispara o template.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId } = await req.json();
    if (!orderId) return json({ error: 'orderId required' }, 400);

    const { data: order } = await supabase
      .from('orders')
      .select('id, event_id, customer_id, products, cart_link, discount_type, discount_value')
      .eq('id', orderId)
      .maybeSingle();
    if (!order) return json({ error: 'Pedido não encontrado' }, 404);
    if (!order.event_id) return json({ error: 'Pedido sem evento vinculado' }, 400);

    const { data: customer } = await supabase
      .from('customers')
      .select('id, instagram_handle, whatsapp')
      .eq('id', order.customer_id)
      .maybeSingle();

    const rawPhone = (customer?.whatsapp || '').replace(/\D/g, '');
    if (!rawPhone) return json({ error: 'Cliente sem WhatsApp cadastrado' }, 400);
    const waPhone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone;

    const { data: eventData } = await supabase
      .from('events')
      .select('whatsapp_number_id, meta_template_name, meta_template_language, meta_template_body_variables, meta_template_header_variable')
      .eq('id', order.event_id)
      .maybeSingle();

    const templateName = (eventData as any)?.meta_template_name || null;
    const whatsappNumberId = (eventData as any)?.whatsapp_number_id || null;
    if (!templateName) {
      return json({ error: 'Nenhum template configurado na etapa MENSAGEM do evento.' }, 400);
    }
    if (!whatsappNumberId) {
      return json({ error: 'Nenhuma instância WhatsApp configurada no evento.' }, 400);
    }

    // ---- Tokens (mesma resolução usada no disparo automático) ----
    const products = (order.products as any[]) || [];
    const productLines = products
      .map((p: any) => `${p.quantity || 1}x ${p.title}${p.variant ? ` (${p.variant})` : ''} — R$${Number(p.price || 0).toFixed(2)}`)
      .join('\n');
    const subtotal = products.reduce(
      (sum: number, p: any) => sum + Number(p.price || 0) * Number(p.quantity || 1),
      0,
    );
    let discountAmount = 0;
    if (order.discount_value && Number(order.discount_value) > 0) {
      discountAmount = order.discount_type === 'percentage'
        ? subtotal * (Number(order.discount_value) / 100)
        : Number(order.discount_value);
    }
    const total = Math.max(0, subtotal - discountAmount);

    const igHandle = customer?.instagram_handle || 'Cliente';
    const igName = igHandle.startsWith('@') ? igHandle : `@${igHandle}`;
    const firstName = (igHandle.replace(/^@/, '').split(/[._\s]/)[0] || '').trim();
    const displayName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : igName;
    const checkoutLink = order.cart_link || `https://checkout.bananacalcados.com.br/checkout/order/${orderId}`;

    const resolveToken = (token: string): string => {
      switch (token) {
        case '{customer_name}': return igHandle || displayName || '';
        case '{customer_first_name}': return displayName || '';
        case '{instagram}': return igName || '';
        case '{products}': return productLines || '';
        case '{products_short}': return products.map((p: any) => `${p.quantity || 1}x ${p.title}`).join(', ');
        case '{checkout_link}': return checkoutLink || '';
        case '{subtotal}': return `R$${subtotal.toFixed(2)}`;
        case '{discount}': return `R$${discountAmount.toFixed(2)}`;
        case '{total}': return `R$${total.toFixed(2)}`;
        case '{order_id}': return String(orderId).slice(0, 8);
        default: return token || '';
      }
    };

    const bodyVars = ((eventData as any)?.meta_template_body_variables as string[]) || [];
    const headerVar = (eventData as any)?.meta_template_header_variable || null;

    const resp = await fetch(`${supabaseUrl}/functions/v1/meta-template-send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: waPhone,
        whatsappNumberId,
        templateName,
        language: (eventData as any)?.meta_template_language || 'pt_BR',
        bodyParameters: bodyVars.map((t) => resolveToken(t)),
        headerParameter: headerVar ? resolveToken(headerVar) : undefined,
      }),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('[event-order-template-send] failed:', resp.status, result);
      return json({ error: (result as any)?.error || 'Falha ao enviar template', details: result }, 502);
    }

    await supabase
      .from('orders')
      .update({ last_sent_message_at: new Date().toISOString() })
      .eq('id', orderId);

    return json({ success: true, templateName, phone: waPhone });
  } catch (e) {
    console.error('[event-order-template-send] error:', e);
    return json({ error: String(e) }, 500);
  }
});
