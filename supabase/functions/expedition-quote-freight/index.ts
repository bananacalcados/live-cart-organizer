import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { order_id } = await req.json();
    if (!order_id) throw new Error('order_id is required');

    const FRENET_TOKEN = Deno.env.get('FRENET_TOKEN');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!FRENET_TOKEN) throw new Error('FRENET_TOKEN not configured');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get order with items
    const { data: order, error: orderError } = await supabase
      .from('expedition_orders')
      .select('*, expedition_order_items(*)')
      .eq('id', order_id)
      .single();

    if (orderError || !order) throw new Error('Order not found');

    const shippingAddress = order.shipping_address as any;
    if (!shippingAddress?.zip) throw new Error('No shipping address zip code');

    // Calculate total weight and dimensions
    const totalWeight = order.total_weight_grams / 1000; // Convert to kg
    const items = order.expedition_order_items || [];
    const totalQty = items.reduce((sum: number, i: any) => sum + i.quantity, 0);

    // Quote via Frenet (real API only)
    const frenetBody = {
      SellerCEP: "01001000",
      RecipientCEP: shippingAddress.zip.replace(/\D/g, ''),
      ShipmentInvoiceValue: order.total_price || 0,
      ShippingItemArray: [{
        Height: Math.max(4, Math.ceil(totalQty * 5)),
        Length: 30,
        Width: 25,
        Weight: Math.max(0.3, totalWeight),
        Quantity: 1,
        SKU: 'PACKAGE',
      }],
      RecipientCountry: 'BR',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const frenetRealResponse = await fetch('https://api.frenet.com.br/shipping/quote', {
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

      if (frenetRealResponse.ok) {
        const frenetData = await frenetRealResponse.json();
        const shippingServices = frenetData.ShippingSevicesArray || frenetData.ShippingServices || [];
        
        for (const svc of shippingServices) {
          if (svc.Error || svc.ShippingPrice <= 0) continue;
          quotes.push({
            expedition_order_id: order_id,
            carrier: svc.Carrier || 'Unknown',
            service: svc.ServiceDescription || svc.ServiceCode || 'Standard',
            price: parseFloat(svc.ShippingPrice || svc.OriginalShippingPrice || '0'),
            delivery_days: parseInt(svc.DeliveryTime || '0'),
          });
        }
      } else {
        await frenetRealResponse.text();
      }
    } catch (e) {
      clearTimeout(timeout);
      console.warn('Frenet request failed/timed out:', e.message);
    }

    // If no Frenet quotes, add a fallback with Correios pricing estimate
    if (quotes.length === 0) {
      // Use Correios Empresa API
      const CORREIOS_USUARIO = Deno.env.get('CORREIOS_EMPRESA_USUARIO');
      const CORREIOS_SENHA = Deno.env.get('CORREIOS_EMPRESA_SENHA');
      const CORREIOS_CODIGO = Deno.env.get('CORREIOS_EMPRESA_CODIGO');
      const CORREIOS_CARTAO = Deno.env.get('CORREIOS_EMPRESA_CARTAO_POSTAGEM');

      if (CORREIOS_USUARIO && CORREIOS_SENHA) {
        // Try Correios Empresa API for SEDEX and PAC
        const services = [
          { code: '03220', name: 'SEDEX' },
          { code: '03298', name: 'PAC' },
        ];

        // Fetch SEDEX and PAC in parallel with timeout
        const correiosPromises = services.map(async (svc) => {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 6000);
          try {
            const correiosUrl = `http://ws.correios.com.br/calculador/CalcPrecoPrazo.aspx?nCdEmpresa=${CORREIOS_CODIGO || ''}&sDsSenha=${CORREIOS_SENHA}&nCdServico=${svc.code}&sCepOrigem=01001000&sCepDestino=${shippingAddress.zip.replace(/\D/g, '')}&nVlPeso=${Math.max(0.3, totalWeight)}&nCdFormato=1&nVlComprimento=30&nVlAltura=${Math.max(4, Math.ceil(totalQty * 5))}&nVlLargura=25&nVlDiametro=0&sCdMaoPropria=N&nVlValorDeclarado=${order.total_price || 0}&sCdAvisoRecebimento=N&StrRetorno=xml&nIndicaCalculo=3`;
            const correiosResponse = await fetch(correiosUrl, { signal: ctrl.signal });
            clearTimeout(t);
            const correiosText = await correiosResponse.text();
            const priceMatch = correiosText.match(/<Valor>([\d,.]+)<\/Valor>/);
            const daysMatch = correiosText.match(/<PrazoEntrega>(\d+)<\/PrazoEntrega>/);
            const errorMatch = correiosText.match(/<Erro>(\d+)<\/Erro>/);
            if (priceMatch && (!errorMatch || errorMatch[1] === '0')) {
              quotes.push({
                expedition_order_id: order_id,
                carrier: 'Correios',
                service: svc.name,
                price: parseFloat(priceMatch[1].replace('.', '').replace(',', '.')),
                delivery_days: daysMatch ? parseInt(daysMatch[1]) : null,
              });
            }
          } catch (e) {
            clearTimeout(t);
            console.error(`Error quoting Correios ${svc.name}:`, e);
          }
        });
        await Promise.all(correiosPromises);
      }
    }

    // Save quotes to DB
    if (quotes.length > 0) {
      // Clear old quotes
      await supabase
        .from('expedition_freight_quotes')
        .delete()
        .eq('expedition_order_id', order_id);

      await supabase
        .from('expedition_freight_quotes')
        .insert(quotes);
    }

    return new Response(JSON.stringify({ success: true, quotes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error quoting freight:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
