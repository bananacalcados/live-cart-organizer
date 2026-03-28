import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { exchange_request_id, cep_origin, cep_destination, weight_kg, height_cm, width_cm, length_cm } = await req.json();

    const FRENET_TOKEN = Deno.env.get('FRENET_TOKEN');
    if (!FRENET_TOKEN) {
      return new Response(JSON.stringify({ error: 'FRENET_TOKEN not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Default dimensions for shoe box if not provided
    const shipWeight = weight_kg || 1.0;
    const shipHeight = height_cm || 15;
    const shipWidth = width_cm || 30;
    const shipLength = length_cm || 35;

    // Quote reverse shipping via Frenet
    console.log(`[exchange-reverse] Quoting reverse shipping from ${cep_origin} to ${cep_destination}`);
    
    const quoteResp = await fetch('https://private-anon-7fae9bafb0-fraborgesfrenet.apiary-proxy.com/shipping/quote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': FRENET_TOKEN,
      },
      body: JSON.stringify({
        SellerCEP: cep_destination, // store CEP (destination for reverse)
        RecipientCEP: cep_origin,   // customer CEP (origin for reverse)
        ShipmentInvoiceValue: 0,
        ShippingServiceCode: null,
        ShippingItemArray: [{
          Height: shipHeight,
          Length: shipLength,
          Quantity: 1,
          Weight: shipWeight,
          Width: shipWidth,
        }],
        RecipientCountry: 'BR',
      }),
    });

    if (!quoteResp.ok) {
      const errText = await quoteResp.text();
      console.error(`[exchange-reverse] Frenet quote error ${quoteResp.status}: ${errText.slice(0, 300)}`);
      return new Response(JSON.stringify({ error: 'Frenet API error', details: errText.slice(0, 200) }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const quoteData = await quoteResp.json();
    console.log(`[exchange-reverse] Frenet quote response:`, JSON.stringify(quoteData).slice(0, 500));

    // Find cheapest available service
    const services = quoteData?.ShippingSevicesArray || quoteData?.ShippingServices || [];
    const available = services.filter((s: any) => !s.Error && s.ShippingPrice > 0);

    if (available.length === 0) {
      // Try Frenet reverse logistics endpoint
      console.log(`[exchange-reverse] No standard services, trying reverse logistics...`);
      
      const reverseResp = await fetch('https://private-anon-7fae9bafb0-fraborgesfrenet.apiary-proxy.com/shipping/trackinginfo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': FRENET_TOKEN,
        },
        body: JSON.stringify({
          CEPOrigem: cep_origin,
          CEPDestino: cep_destination,
          Peso: shipWeight,
          Comprimento: shipLength,
          Altura: shipHeight,
          Largura: shipWidth,
        }),
      });

      if (reverseResp.ok) {
        const reverseData = await reverseResp.json();
        console.log(`[exchange-reverse] Reverse logistics response:`, JSON.stringify(reverseData).slice(0, 500));
        
        if (reverseData?.TrackingNumber || reverseData?.CodigoPostagem) {
          const trackingCode = reverseData.TrackingNumber || reverseData.CodigoPostagem;

          // Update exchange request
          if (exchange_request_id) {
            await supabase.from('exchange_requests').update({
              reverse_shipping_code: trackingCode,
              shipping_carrier: reverseData.Carrier || 'Correios',
              status: 'aguardando_postagem',
            }).eq('id', exchange_request_id);
          }

          return new Response(JSON.stringify({
            success: true,
            tracking_code: trackingCode,
            carrier: reverseData.Carrier || 'Correios',
            method: 'reverse_logistics',
          }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'no_services_available',
        message: 'Nenhum serviço de frete reverso disponível para esse CEP. Será necessário atendimento humano.',
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sort by price and pick cheapest
    available.sort((a: any, b: any) => a.ShippingPrice - b.ShippingPrice);
    const cheapest = available[0];

    // Update exchange request with shipping info
    if (exchange_request_id) {
      await supabase.from('exchange_requests').update({
        shipping_carrier: cheapest.Carrier || cheapest.ServiceDescription || 'Correios',
        frenet_quote_id: cheapest.ServiceCode || null,
        status: 'aprovado',
      }).eq('id', exchange_request_id);
    }

    return new Response(JSON.stringify({
      success: true,
      services: available.map((s: any) => ({
        carrier: s.Carrier,
        service: s.ServiceDescription,
        price: s.ShippingPrice,
        delivery_days: s.DeliveryTime,
        service_code: s.ServiceCode,
      })),
      cheapest: {
        carrier: cheapest.Carrier,
        service: cheapest.ServiceDescription,
        price: cheapest.ShippingPrice,
        delivery_days: cheapest.DeliveryTime,
      },
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[exchange-reverse] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
