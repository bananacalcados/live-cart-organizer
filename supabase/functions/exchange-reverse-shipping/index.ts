import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ME_HEADERS = (token: string) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Livete CRM (contato@livete.com.br)',
});

// Fixed store destination (Tiny Pérola — Melhor Envio account)
const STORE_DESTINATION = {
  name: 'Tiny Perola',
  phone: '33991230581',
  email: 'mattws.aguiar@gmail.com',
  cpf: '15023139794',
  cnpj: '26586173000127',
  postal_code: '35051520',
  address: 'Rua Vale Formoso',
  number: '362',
  complement: 'LOJA',
  district: 'Kennedy',
  city: 'Governador Valadares',
  state_abbr: 'MG',
};

// Correios service IDs in Melhor Envio
const CORREIOS_SERVICE_IDS = {
  SEDEX: 1,
  PAC: 2,
  MINI: 17,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      exchange_request_id,
      customer_name,
      customer_cpf,
      customer_email,
      customer_phone,
      customer_cep,
      customer_address,
      customer_number,
      customer_district,
      customer_city,
      customer_state,
      product_name,
      insurance_value = 100,
      weight_kg = 1.0,
      height_cm = 15,
      width_cm = 30,
      length_cm = 35,
    } = body;

    if (!customer_cpf || !customer_cep || !customer_name) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'customer_name, customer_cpf and customer_cep are required' 
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ME_TOKEN = Deno.env.get('MELHOR_ENVIO_TOKEN');
    if (!ME_TOKEN) {
      return new Response(JSON.stringify({ success: false, error: 'MELHOR_ENVIO_TOKEN not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Clean CPF (digits only, must be different from store CPF)
    const cleanCpf = (customer_cpf || '').replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      return new Response(JSON.stringify({ success: false, error: 'CPF inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanCep = (customer_cep || '').replace(/\D/g, '');

    // ── Step 1: Quote reverse shipping (Correios only) ──
    console.log(`[exchange-reverse] Quoting reverse from ${cleanCep} to ${STORE_DESTINATION.postal_code}`);
    
    const quoteResp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/calculate', {
      method: 'POST',
      headers: ME_HEADERS(ME_TOKEN),
      body: JSON.stringify({
        from: { postal_code: cleanCep },
        to: { postal_code: STORE_DESTINATION.postal_code },
        reverse: true,
        services: `${CORREIOS_SERVICE_IDS.PAC},${CORREIOS_SERVICE_IDS.SEDEX}`,
        products: [{
          id: 'exchange',
          width: width_cm,
          height: height_cm,
          length: length_cm,
          weight: weight_kg,
          insurance_value: insurance_value,
          quantity: 1,
        }],
      }),
    });

    const quoteData = await quoteResp.json();
    console.log(`[exchange-reverse] Quote response:`, JSON.stringify(quoteData).slice(0, 500));

    // Filter only Correios services without errors
    const availableServices = (Array.isArray(quoteData) ? quoteData : [])
      .filter((s: any) => !s.error && s.price && parseFloat(s.price) > 0)
      .filter((s: any) => {
        const name = (s.name || s.company?.name || '').toLowerCase();
        return name.includes('correios') || name.includes('pac') || name.includes('sedex');
      });

    if (availableServices.length === 0) {
      console.error('[exchange-reverse] No Correios services available for this route');
      
      if (exchange_request_id) {
        await supabase.from('exchange_requests').update({
          status: 'erro_logistica',
        }).eq('id', exchange_request_id);
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'no_correios_services',
        message: 'Nenhum serviço dos Correios disponível para essa rota. Será necessário atendimento humano.',
        raw_quote: quoteData,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pick cheapest Correios service
    availableServices.sort((a: any, b: any) => parseFloat(a.price) - parseFloat(b.price));
    const chosen = availableServices[0];
    const serviceId = chosen.id;

    console.log(`[exchange-reverse] Chosen: ${chosen.name} (ID ${serviceId}) - R$ ${chosen.price} - ${chosen.delivery_time} days`);

    // ── Step 2: Add to cart (reverse, non_commercial = declaração de conteúdo) ──
    const cartPayload = {
      service: serviceId,
      reverse: true,
      from: {
        name: customer_name,
        phone: (customer_phone || '').replace(/\D/g, '') || '00000000000',
        email: customer_email || 'cliente@banana.com',
        document: cleanCpf,
        postal_code: cleanCep,
        address: customer_address || 'Endereço não informado',
        number: customer_number || 'S/N',
        district: customer_district || 'Centro',
        city: customer_city || 'Cidade',
        state_abbr: customer_state || 'MG',
        country_id: 'BR',
      },
      to: {
        name: STORE_DESTINATION.name,
        phone: STORE_DESTINATION.phone,
        email: STORE_DESTINATION.email,
        document: STORE_DESTINATION.cpf,
        company_document: STORE_DESTINATION.cnpj,
        postal_code: STORE_DESTINATION.postal_code,
        address: STORE_DESTINATION.address,
        number: STORE_DESTINATION.number,
        complement: STORE_DESTINATION.complement,
        district: STORE_DESTINATION.district,
        city: STORE_DESTINATION.city,
        state_abbr: STORE_DESTINATION.state_abbr,
        country_id: 'BR',
      },
      products: [{
        name: product_name || 'Produto Troca',
        quantity: 1,
        unitary_value: insurance_value,
      }],
      volumes: [{
        height: height_cm,
        width: width_cm,
        length: length_cm,
        weight: weight_kg,
      }],
      options: {
        insurance_value: insurance_value,
        reverse: true,
        non_commercial: true,
        platform: 'Livete CRM',
      },
    };

    console.log(`[exchange-reverse] Adding to cart...`);
    const cartResp = await fetch('https://melhorenvio.com.br/api/v2/me/cart', {
      method: 'POST',
      headers: ME_HEADERS(ME_TOKEN),
      body: JSON.stringify(cartPayload),
    });

    const cartData = await cartResp.json();
    console.log(`[exchange-reverse] Cart response:`, JSON.stringify(cartData).slice(0, 500));

    if (cartData.errors || cartData.error || !cartData.id) {
      console.error('[exchange-reverse] Cart error:', JSON.stringify(cartData));
      return new Response(JSON.stringify({
        success: false,
        error: 'cart_error',
        message: 'Erro ao adicionar envio reverso ao carrinho do Melhor Envio.',
        details: cartData.errors || cartData.error || cartData,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cartOrderId = cartData.id;

    // ── Step 3: Checkout (purchase the label) ──
    console.log(`[exchange-reverse] Checking out order ${cartOrderId}...`);
    const checkoutResp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/checkout', {
      method: 'POST',
      headers: ME_HEADERS(ME_TOKEN),
      body: JSON.stringify({ orders: [cartOrderId] }),
    });

    const checkoutData = await checkoutResp.json();
    console.log(`[exchange-reverse] Checkout response:`, JSON.stringify(checkoutData).slice(0, 500));

    // ── Step 4: Generate label ──
    console.log(`[exchange-reverse] Generating label for ${cartOrderId}...`);
    const generateResp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/generate', {
      method: 'POST',
      headers: ME_HEADERS(ME_TOKEN),
      body: JSON.stringify({ orders: [cartOrderId] }),
    });

    const generateData = await generateResp.json();
    console.log(`[exchange-reverse] Generate response:`, JSON.stringify(generateData).slice(0, 500));

    // ── Step 5: Print label (get URL) ──
    console.log(`[exchange-reverse] Printing label for ${cartOrderId}...`);
    const printResp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/print', {
      method: 'POST',
      headers: ME_HEADERS(ME_TOKEN),
      body: JSON.stringify({ mode: 'private', orders: [cartOrderId] }),
    });

    const printData = await printResp.json();
    console.log(`[exchange-reverse] Print response:`, JSON.stringify(printData).slice(0, 300));

    // Extract tracking code from cart data or checkout
    const trackingCode = cartData.tracking || checkoutData?.[cartOrderId]?.tracking || null;
    const labelUrl = printData?.url || null;

    // Update exchange request in DB
    if (exchange_request_id) {
      await supabase.from('exchange_requests').update({
        reverse_shipping_code: trackingCode || `ME-${cartOrderId}`,
        reverse_tracking_url: labelUrl,
        shipping_carrier: chosen.name || 'Correios',
        status: 'aguardando_postagem',
      }).eq('id', exchange_request_id);
    }

    return new Response(JSON.stringify({
      success: true,
      melhor_envio_order_id: cartOrderId,
      tracking_code: trackingCode,
      label_url: labelUrl,
      carrier: chosen.name || 'Correios',
      service: chosen.name,
      price: parseFloat(chosen.price),
      delivery_days: chosen.delivery_time,
      method: 'melhor_envio_reverse',
      instructions: `Leve o pacote até uma agência dos Correios mais próxima. Informe o código de postagem ${trackingCode || cartOrderId} no balcão.`,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[exchange-reverse] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error?.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
