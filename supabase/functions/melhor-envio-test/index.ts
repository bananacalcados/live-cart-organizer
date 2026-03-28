import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const ME_TOKEN = Deno.env.get('MELHOR_ENVIO_TOKEN');
    if (!ME_TOKEN) {
      return new Response(JSON.stringify({ error: 'MELHOR_ENVIO_TOKEN not set' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action } = await req.json();

    // Test 1: Check auth / user info
    if (action === 'me') {
      const resp = await fetch('https://melhorenvio.com.br/api/v2/me', {
        headers: {
          'Authorization': `Bearer ${ME_TOKEN}`,
          'Accept': 'application/json',
          'User-Agent': 'Livete CRM (contato@livete.com.br)',
        },
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Test 2: Quote a reverse shipment
    if (action === 'quote_reverse') {
      const body = await req.json().catch(() => ({}));
      const fromCep = body.from_cep || '01001000'; // customer CEP
      const toCep = body.to_cep || '80010000';     // store CEP
      
      const resp = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/calculate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ME_TOKEN}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Livete CRM (contato@livete.com.br)',
        },
        body: JSON.stringify({
          from: { postal_code: fromCep },
          to: { postal_code: toCep },
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
        headers: {
          'Authorization': `Bearer ${ME_TOKEN}`,
          'Accept': 'application/json',
          'User-Agent': 'Livete CRM (contato@livete.com.br)',
        },
      });
      const data = await resp.json();
      return new Response(JSON.stringify({ status: resp.status, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'action must be: me, quote_reverse, or balance' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
