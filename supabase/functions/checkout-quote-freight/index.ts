import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// CEP range for Governador Valadares/MG: 35010-000 to 35064-999
function isGVCep(cep: string): boolean {
  const num = parseInt(cep.replace(/\D/g, ''), 10);
  return num >= 35010000 && num <= 35064999;
}

// Store CEP origins
const STORE_CEPS: Record<string, string> = {
  centro: '35010002',
  perola: '35051520',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recipient_cep, store, total_value, weight_kg, items_count, order_id } = await req.json();
    if (!recipient_cep) throw new Error('recipient_cep is required');

    const cepDigits = recipient_cep.replace(/\D/g, '');
    if (cepDigits.length !== 8) throw new Error('CEP inválido');

    const FRENET_TOKEN = Deno.env.get('FRENET_TOKEN');
    const storeLower = (store || 'centro').toLowerCase();
    const originCep = STORE_CEPS[storeLower] || STORE_CEPS.centro;
    const totalWeight = Math.max(0.3, weight_kg || 0.3);
    const totalQty = items_count || 1;

    let repeatCustomerFreeShipping = false;

    // Check if this customer already paid shipping in the same event
    if (order_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: currentOrder } = await supabase
          .from('orders')
          .select('event_id, customer_id')
          .eq('id', order_id)
          .single();

        if (currentOrder?.event_id && currentOrder?.customer_id) {
          const { data: paidOrders } = await supabase
            .from('orders')
            .select('id, shipping_cost')
            .eq('event_id', currentOrder.event_id)
            .eq('customer_id', currentOrder.customer_id)
            .neq('id', order_id)
            .or('is_paid.eq.true,paid_externally.eq.true')
            .gt('shipping_cost', 0)
            .limit(1);

          if (paidOrders && paidOrders.length > 0) {
            repeatCustomerFreeShipping = true;
            console.log(`Repeat customer detected: order ${order_id}, previous paid order ${paidOrders[0].id} with shipping ${paidOrders[0].shipping_cost}`);
          }
        }
      } catch (e) {
        console.warn('Error checking repeat customer:', e.message);
      }
    }

    const quotes: Array<{
      id: string;
      carrier: string;
      service: string;
      price: number;
      delivery_days: number | null;
      type: string;
    }> = [];

    // 0. If repeat customer, add free shipping option first
    if (repeatCustomerFreeShipping) {
      quotes.push({
        id: 'repeat-free',
        carrier: 'Frete já pago em compra anterior',
        service: 'Grátis ✅',
        price: 0,
        delivery_days: null,
        type: 'repeat_free',
      });
    }

    // 1. Always add "Retirada na loja"
    quotes.push({
      id: 'pickup',
      carrier: 'Retirada na Loja',
      service: 'Grátis',
      price: 0,
      delivery_days: 0,
      type: 'pickup',
    });

    // 2. If CEP is in GV, add Mototaxista
    if (isGVCep(cepDigits)) {
      quotes.push({
        id: 'mototaxi',
        carrier: 'Mototaxista 🏍️',
        service: 'Entrega Local',
        price: 9.99,
        delivery_days: 0,
        type: 'local',
      });
    }

    // 3. Quote via Frenet
    if (FRENET_TOKEN) {
      const frenetBody = {
        SellerCEP: originCep,
        RecipientCEP: cepDigits,
        ShipmentInvoiceValue: total_value || 0,
        ShippingItemArray: [{
          Height: Math.max(4, Math.ceil(totalQty * 5)),
          Length: 30,
          Width: 25,
          Weight: totalWeight,
          Quantity: 1,
          SKU: 'PACKAGE',
        }],
        RecipientCountry: 'BR',
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        console.log('Quoting Frenet for checkout...', JSON.stringify({ originCep, cepDigits }));
        const frenetResponse = await fetch('https://api.frenet.com.br/shipping/quote', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'token': FRENET_TOKEN,
            'Accept': 'application/json',
          },
          body: JSON.stringify(frenetBody),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (frenetResponse.ok) {
          const frenetData = await frenetResponse.json();
          console.log('Frenet response:', JSON.stringify(frenetData).substring(0, 500));
          const services = frenetData.ShippingSevicesArray || frenetData.ShippingServices || [];

          for (const svc of services) {
            if (svc.Error || svc.ShippingPrice <= 0) continue;
            const price = parseFloat(svc.ShippingPrice || svc.OriginalShippingPrice || '0');
            if (price <= 0) continue;
            quotes.push({
              id: `frenet-${svc.ServiceCode || svc.Carrier}`,
              carrier: svc.Carrier || 'Transportadora',
              service: svc.ServiceDescription || svc.ServiceCode || 'Padrão',
              price,
              delivery_days: parseInt(svc.DeliveryTime || '0') || null,
              type: 'carrier',
            });
          }
        } else {
          console.error('Frenet error:', await frenetResponse.text().then(t => t.substring(0, 300)));
        }
      } catch (e) {
        clearTimeout(timeout);
        console.warn('Frenet request failed:', e.message);
      }
    } else {
      console.warn('FRENET_TOKEN not configured');
    }

    // Sort: repeat_free first, then pickup, then local, then by price
    quotes.sort((a, b) => {
      if (a.type === 'repeat_free') return -1;
      if (b.type === 'repeat_free') return 1;
      if (a.type === 'pickup') return -1;
      if (b.type === 'pickup') return 1;
      if (a.type === 'local') return -1;
      if (b.type === 'local') return 1;
      return a.price - b.price;
    });

    return new Response(JSON.stringify({ success: true, quotes, repeat_customer_free_shipping: repeatCustomerFreeShipping }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
