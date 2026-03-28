import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ME_HEADERS = (token: string) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Livete CRM (contato@livete.com.br)',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const ME_TOKEN = Deno.env.get('MELHOR_ENVIO_TOKEN');
    if (!ME_TOKEN) {
      return new Response(JSON.stringify({ error: 'MELHOR_ENVIO_TOKEN not set' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action } = body;

    // Test 1: Check auth / user info
    if (action === 'me') {
      const resp = await fetch('https://melhorenvio.com.br/api/v2/me', {
        headers: ME_HEADERS(ME_TOKEN),
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test 2: Quote a reverse shipment
    if (action === 'quote_reverse') {
      const fromCep = body.from_cep || '01001000';
      const toCep = body.to_cep || '35051520';
      
      const resp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/calculate', {
        method: 'POST',
        headers: ME_HEADERS(ME_TOKEN),
        body: JSON.stringify({
          from: { postal_code: fromCep },
          to: { postal_code: toCep },
          reverse: true,
          products: [{
            id: 'test',
            width: 30,
            height: 15,
            length: 35,
            weight: 1.0,
            insurance_value: 100,
            quantity: 1,
          }],
        }),
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test 3: Check balance
    if (action === 'balance') {
      const resp = await fetch('https://melhorenvio.com.br/api/v2/me/balance', {
        headers: ME_HEADERS(ME_TOKEN),
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test 4: Add reverse shipment to cart
    if (action === 'cart_reverse') {
      const fromCep = body.from_cep || '01001000'; // customer
      const toCep = body.to_cep || '35051520';     // store
      const serviceId = body.service_id || 2;       // 2 = PAC, 1 = SEDEX

      const cartPayload = {
        service: serviceId,
        agency: body.agency_id || null,
        reverse: true,
        from: {
          name: body.from_name || 'Cliente Teste',
          phone: body.from_phone || '11999999999',
          email: body.from_email || 'cliente@teste.com',
          document: body.from_cpf || '00000000000',
          postal_code: fromCep,
          address: body.from_address || 'Rua Teste',
          number: body.from_number || '100',
          district: body.from_district || 'Centro',
          city: body.from_city || 'São Paulo',
          state_abbr: body.from_state || 'SP',
          country_id: 'BR',
        },
        to: {
          name: 'Tiny Perola',
          phone: '33991230581',
          email: 'mattws.aguiar@gmail.com',
          document: body.to_cpf || '15023139794',
          company_document: body.to_cnpj || '26586173000127',
          postal_code: toCep,
          address: body.to_address || 'Rua Vale Formoso',
          number: body.to_number || '100',
          district: body.to_district || 'Santos Dumont',
          city: body.to_city || 'Governador Valadares',
          state_abbr: body.to_state || 'MG',
          country_id: 'BR',
        },
        products: [{
          name: 'Produto Troca',
          quantity: 1,
          unitary_value: 100,
        }],
        volumes: [{
          height: 15,
          width: 30,
          length: 35,
          weight: 1.0,
        }],
        options: {
          insurance_value: 100,
          reverse: true,
          non_commercial: body.non_commercial || true,
          invoice: body.invoice || null,
          platform: 'Livete CRM',
        },
      };

      console.log('Cart reverse payload:', JSON.stringify(cartPayload, null, 2));

      const resp = await fetch('https://melhorenvio.com.br/api/v2/me/cart', {
        method: 'POST',
        headers: ME_HEADERS(ME_TOKEN),
        body: JSON.stringify(cartPayload),
      });
      const data = await resp.json();
      console.log('Cart reverse response:', JSON.stringify(data, null, 2));
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test 5: Checkout (purchase the label)
    if (action === 'checkout') {
      const { order_ids } = body; // array of cart order IDs
      if (!order_ids?.length) throw new Error('order_ids required');

      const resp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/checkout', {
        method: 'POST',
        headers: ME_HEADERS(ME_TOKEN),
        body: JSON.stringify({ orders: order_ids }),
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test 6: Generate label
    if (action === 'generate') {
      const { order_ids } = body;
      if (!order_ids?.length) throw new Error('order_ids required');

      const resp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/generate', {
        method: 'POST',
        headers: ME_HEADERS(ME_TOKEN),
        body: JSON.stringify({ orders: order_ids }),
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test 7: Print label
    if (action === 'print') {
      const { order_ids } = body;
      if (!order_ids?.length) throw new Error('order_ids required');

      const resp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/print', {
        method: 'POST',
        headers: ME_HEADERS(ME_TOKEN),
        body: JSON.stringify({ mode: 'private', orders: order_ids }),
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test 8: Get cart items
    if (action === 'cart_list') {
      const resp = await fetch('https://melhorenvio.com.br/api/v2/me/cart', {
        headers: ME_HEADERS(ME_TOKEN),
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test 9: Cancel cart item
    if (action === 'cancel') {
      const { order_id } = body;
      if (!order_id) throw new Error('order_id required');

      const resp = await fetch(`https://melhorenvio.com.br/api/v2/me/shipment/cancel`, {
        method: 'POST',
        headers: ME_HEADERS(ME_TOKEN),
        body: JSON.stringify({ order: { id: order_id, reason_id: 2 } }),
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'action must be: me, quote_reverse, balance, cart_reverse, checkout, generate, print, cart_list, cancel' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
