import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// CEP range for Governador Valadares/MG: 35010-000 to 35065-999
function isGVCep(cep: string): boolean {
  const num = parseInt(cep.replace(/\D/g, ''), 10);
  return num >= 35010000 && num <= 35065999;
}

// Map CEP prefix to Brazilian state
function cepToState(cep: string): string | null {
  const n = parseInt(cep.substring(0, 5), 10);
  if (n >= 1000 && n <= 19999) return 'SP';
  if (n >= 20000 && n <= 28999) return 'RJ';
  if (n >= 29000 && n <= 29999) return 'ES';
  if (n >= 30000 && n <= 39999) return 'MG';
  if (n >= 40000 && n <= 48999) return 'BA';
  if (n >= 49000 && n <= 49999) return 'SE';
  if (n >= 50000 && n <= 56999) return 'PE';
  if (n >= 57000 && n <= 57999) return 'AL';
  if (n >= 58000 && n <= 58999) return 'PB';
  if (n >= 59000 && n <= 59999) return 'RN';
  if (n >= 60000 && n <= 63999) return 'CE';
  if (n >= 64000 && n <= 64999) return 'PI';
  if (n >= 65000 && n <= 65999) return 'MA';
  if (n >= 66000 && n <= 68899) return 'PA';
  if (n >= 68900 && n <= 68999) return 'AP';
  if (n >= 69000 && n <= 69299) return 'AM';
  if (n >= 69300 && n <= 69399) return 'RR';
  if (n >= 69400 && n <= 69899) return 'AM';
  if (n >= 69900 && n <= 69999) return 'AC';
  if (n >= 70000 && n <= 72799) return 'DF';
  if (n >= 72800 && n <= 72999) return 'GO';
  if (n >= 73000 && n <= 73699) return 'GO';
  if (n >= 73700 && n <= 76799) return 'GO';
  if (n >= 74000 && n <= 76799) return 'GO';
  if (n >= 76800 && n <= 76999) return 'RO';
  if (n >= 77000 && n <= 77999) return 'TO';
  if (n >= 78000 && n <= 78899) return 'MT';
  if (n >= 79000 && n <= 79999) return 'MS';
  if (n >= 80000 && n <= 87999) return 'PR';
  if (n >= 88000 && n <= 89999) return 'SC';
  if (n >= 90000 && n <= 99999) return 'RS';
  return null;
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
    const { recipient_cep, store, total_value, weight_kg, items_count, order_id, event_id, store_id, free_shipping, fixed_shipping } = await req.json();
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

    // Caller-provided overrides:
    //  - free_shipping: order/sale was marked as free in the card (handled by the callers,
    //    here we only use it to SKIP the fixed-price override).
    //  - fixed_shipping: per-sale shipping value typed by the seller (POS online link).
    const forceFreeShipping = free_shipping === true;
    const explicitFixedShipping: number | null =
      (typeof fixed_shipping === 'number' && fixed_shipping > 0) ? fixed_shipping : null;

    // Event-level shipping config (set in the event setup wizard).
    //  - eventDefaultShipping: fixed value applied to the cheapest carrier.
    //  - eventFreeThreshold: free shipping (cheapest carrier) when total >= threshold.
    let eventDefaultShipping: number | null = null;
    let eventFreeThreshold: number | null = null;
    if (event_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const sb = createClient(supabaseUrl, supabaseKey);
        const { data: ev } = await sb
          .from('events')
          .select('default_shipping_cost, free_shipping_threshold')
          .eq('id', event_id)
          .maybeSingle();
        if (ev?.default_shipping_cost != null && Number(ev.default_shipping_cost) > 0) {
          eventDefaultShipping = Number(ev.default_shipping_cost);
        }
        if (ev?.free_shipping_threshold != null && Number(ev.free_shipping_threshold) > 0) {
          eventFreeThreshold = Number(ev.free_shipping_threshold);
        }
      } catch (e) {
        console.warn('Error fetching event shipping config:', e.message);
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

    // 1. Retirada na loja + Mototaxista — APENAS para Governador Valadares.
    if (isGVCep(cepDigits)) {
      quotes.push({
        id: 'pickup',
        carrier: 'Retirada na Loja',
        service: 'Grátis',
        price: 0,
        delivery_days: 0,
        type: 'pickup',
      });
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

    // === Apply shipping rules ===
    let shippingRules: any[] = [];
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, supabaseKey);

      let query = sb.from('shipping_rules').select('*').eq('is_active', true).order('priority', { ascending: false });
      if (event_id) {
        query = query.or(`event_id.eq.${event_id},event_id.is.null`);
      } else if (store_id) {
        query = query.or(`store_id.eq.${store_id},store_id.is.null`);
      } else {
        query = query.is('event_id', null).is('store_id', null);
      }
      const { data: rulesData } = await query;
      shippingRules = rulesData || [];
    } catch (e) {
      console.warn('Error fetching shipping rules:', e.message);
    }

    // === Apply shipping rules & fixed-price override ===
    const destState = cepToState(cepDigits);

    // Sort rules: event-specific first, then by priority.
    const sortedRules = [...shippingRules].sort((a: any, b: any) => {
      if (a.event_id && !b.event_id) return -1;
      if (!a.event_id && b.event_id) return 1;
      return (b.priority || 0) - (a.priority || 0);
    });

    // 1. Targeted carrier_match rules (per-carrier fixed price / discounts) keep working.
    for (const q of quotes) {
      if (q.type !== 'carrier') continue;
      const rule = sortedRules.find((r: any) => {
        if (!r.carrier_match) return false;
        if (r.region_states && r.region_states.length > 0) {
          if (!destState || !r.region_states.includes(destState)) return false;
        }
        const carrierLower = (q.carrier + ' ' + q.service).toLowerCase();
        return carrierLower.includes(r.carrier_match.toLowerCase());
      });
      if (!rule) continue;
      if (rule.rule_type === 'fixed_price' && rule.fixed_price != null) {
        q.price = rule.fixed_price;
      } else if (rule.rule_type === 'discount_percentage' && rule.discount_percentage != null) {
        q.price = Math.max(0, q.price * (1 - rule.discount_percentage / 100));
      } else if (rule.rule_type === 'discount_fixed' && rule.discount_fixed != null) {
        q.price = Math.max(0, q.price - rule.discount_fixed);
      }
      q.price = Math.round(q.price * 100) / 100;
    }

    // 2. Resolve the SINGLE fixed shipping value that REPLACES the cheapest carrier quote.
    //    Priority: region-specific rule > explicit per-sale value > event default > global rule.
    const regionRule = sortedRules.find((r: any) =>
      r.rule_type === 'fixed_price' && r.fixed_price != null && !r.carrier_match &&
      r.region_states && r.region_states.length > 0 && destState && r.region_states.includes(destState)
    );
    const globalRule = sortedRules.find((r: any) =>
      r.rule_type === 'fixed_price' && r.fixed_price != null && !r.carrier_match &&
      (!r.region_states || r.region_states.length === 0)
    );

    let fixedShippingValue: number | null = null;
    if (regionRule) fixedShippingValue = Number(regionRule.fixed_price);
    else if (explicitFixedShipping != null) fixedShippingValue = explicitFixedShipping;
    else if (eventDefaultShipping != null) fixedShippingValue = eventDefaultShipping;
    else if (globalRule) fixedShippingValue = Number(globalRule.fixed_price);

    // 3. Apply the override to the CHEAPEST carrier quote (raise OR lower its price).
    //    Skipped entirely when the order/sale was marked as free shipping (handled by callers).
    //    Free-shipping-above-threshold has PRIORITY over the fixed value when the order
    //    total reaches the configured threshold.
    const qualifiesForEventFree =
      eventFreeThreshold != null && Number(total_value || 0) >= eventFreeThreshold;

    if (!forceFreeShipping && (qualifiesForEventFree || fixedShippingValue != null)) {
      const targetValue = qualifiesForEventFree ? 0 : (fixedShippingValue as number);
      const targetType = qualifiesForEventFree ? 'event_free' : 'event_fixed';
      const carrierQuotes = quotes.filter(q => q.type === 'carrier');
      if (carrierQuotes.length > 0) {
        const cheapest = carrierQuotes.reduce((acc, cur) => (cur.price < acc.price ? cur : acc));
        cheapest.price = Math.round(targetValue * 100) / 100;
        cheapest.type = targetType;
        if (qualifiesForEventFree) {
          cheapest.carrier = `${cheapest.carrier} — Frete Grátis ✅`;
        }
      } else {
        // Frenet returned nothing — still offer the value so the customer can pay.
        quotes.push({
          id: qualifiesForEventFree ? 'event-free' : 'fixed-shipping',
          carrier: qualifiesForEventFree ? 'Frete Grátis ✅' : 'Frete',
          service: qualifiesForEventFree ? 'Cortesia' : 'Padrão',
          price: Math.round(targetValue * 100) / 100,
          delivery_days: null,
          type: targetType,
        });
      }
    }

    // Sort: free options first, then event_fixed, then pickup, then local, then by price
    quotes.sort((a, b) => {
      if (a.type === 'event_free') return -1;
      if (b.type === 'event_free') return 1;
      if (a.type === 'repeat_free') return -1;
      if (b.type === 'repeat_free') return 1;
      if (a.type === 'event_fixed') return -1;
      if (b.type === 'event_fixed') return 1;
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
