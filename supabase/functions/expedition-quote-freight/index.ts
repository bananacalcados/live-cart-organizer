import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function safeJson(response: Response, label: string) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error(`${label} returned non-JSON:`, text.substring(0, 500));
    throw new Error(`${label}: resposta inválida da API Tiny - "${text.substring(0, 100)}"`);
  }
}

// Fetch all shipping methods from Tiny (formas de envio + formas de frete)
async function fetchTinyShippingMethods(token: string) {
  const methods: Array<{
    formaEnvioId: string;
    formaEnvioDescricao: string;
    formaEnvioCodigo: string;
    fretes: Array<{
      formaFreteId: string;
      formaFreteDescricao: string;
      serviceCode: string;
    }>;
  }> = [];

  try {
    console.log('Fetching Tiny shipping methods (formas.envio.pesquisa.php)...');
    const searchResp = await fetch('https://api.tiny.com.br/api2/formas.envio.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json`,
    });
    const searchData = await safeJson(searchResp, 'Pesquisa formas de envio');
    console.log('Tiny formas envio response:', JSON.stringify(searchData).substring(0, 1000));

    if (searchData.retorno?.status !== 'OK' && searchData.retorno?.status !== 'Processado') {
      console.warn('Could not fetch Tiny shipping methods:', JSON.stringify(searchData.retorno));
      return methods;
    }

    const formasEnvio = searchData.retorno?.formas_envio || searchData.retorno?.formasEnvio || [];
    console.log(`Found ${formasEnvio.length} shipping methods in Tiny`);

    // For each forma de envio, get the details (formas de frete)
    for (const entry of formasEnvio) {
      const fe = entry?.forma_envio || entry?.formaEnvio || entry;
      const feId = String(fe.id || '');
      const feDescricao = fe.descricao || fe.nome || '';
      const feCodigo = fe.codigo || fe.tipo || '';

      if (!feId) continue;

      try {
        const detailResp = await fetch('https://api.tiny.com.br/api2/formas.envio.obter.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&id=${feId}`,
        });
        const detailData = await safeJson(detailResp, `Obter forma envio ${feId}`);
        
        const formaEnvioDetail = detailData.retorno?.forma_envio || detailData.retorno?.formaEnvio || {};
        const formasFrete = formaEnvioDetail.formas_frete || formaEnvioDetail.formasFrete || [];

        const fretes: Array<{ formaFreteId: string; formaFreteDescricao: string; serviceCode: string }> = [];
        for (const ffEntry of formasFrete) {
          const ff = ffEntry?.forma_frete || ffEntry?.formaFrete || ffEntry;
          fretes.push({
            formaFreteId: String(ff.id || ''),
            formaFreteDescricao: ff.descricao || ff.nome || '',
            serviceCode: ff.codigo_servico || ff.codigoServico || '',
          });
        }

        methods.push({
          formaEnvioId: feId,
          formaEnvioDescricao: feDescricao,
          formaEnvioCodigo: feCodigo,
          fretes,
        });

        console.log(`Forma envio "${feDescricao}" (${feId}): ${fretes.length} formas de frete`);
      } catch (e) {
        console.warn(`Error getting details for forma envio ${feId}:`, e);
      }
    }
  } catch (e) {
    console.error('Error fetching Tiny shipping methods:', e);
  }

  return methods;
}

// Match a Frenet quote to a Tiny shipping method
function matchFrenetToTiny(
  frenetCarrier: string,
  frenetService: string,
  frenetServiceCode: string,
  tinyMethods: Awaited<ReturnType<typeof fetchTinyShippingMethods>>
): { formaEnvioId: string; formaFreteId: string; serviceCode: string } | null {
  const carrier = (frenetCarrier || '').toLowerCase();
  const service = (frenetService || '').toLowerCase();
  const code = frenetServiceCode || '';

  for (const method of tinyMethods) {
    const desc = method.formaEnvioDescricao.toLowerCase();
    
    // Match carrier name
    const carrierMatch =
      (carrier.includes('correio') && (desc.includes('correio') || method.formaEnvioCodigo === 'C')) ||
      (carrier.includes('j&t') && (desc.includes('j&t') || desc.includes('jt'))) ||
      (carrier.includes('jadlog') && desc.includes('jadlog')) ||
      (carrier.includes('loggi') && desc.includes('loggi')) ||
      (carrier.includes('total') && desc.includes('total')) ||
      desc.includes(carrier.split(' ')[0]); // Partial name match

    if (!carrierMatch) continue;

    // Try to match the specific service (PAC, SEDEX, etc.)
    for (const frete of method.fretes) {
      const freteDesc = frete.formaFreteDescricao.toLowerCase();
      const freteCode = frete.serviceCode;

      // Match by service code first (most precise)
      if (code && freteCode && code === freteCode) {
        return { formaEnvioId: method.formaEnvioId, formaFreteId: frete.formaFreteId, serviceCode: freteCode };
      }

      // Match by service description
      if (
        (service.includes('pac') && freteDesc.includes('pac')) ||
        (service.includes('sedex') && !service.includes('10') && !service.includes('12') && freteDesc.includes('sedex') && !freteDesc.includes('10') && !freteDesc.includes('12')) ||
        (service.includes('sedex 10') && freteDesc.includes('sedex 10')) ||
        (service.includes('sedex 12') && freteDesc.includes('sedex 12')) ||
        (service.includes('standard') && freteDesc.includes('standard')) ||
        (service.includes('express') && freteDesc.includes('express')) ||
        freteDesc.includes(service.split(' ')[0])
      ) {
        return { formaEnvioId: method.formaEnvioId, formaFreteId: frete.formaFreteId, serviceCode: freteCode || code };
      }
    }

    // If carrier matched but no specific frete, use first available
    if (method.fretes.length > 0) {
      const first = method.fretes[0];
      return { formaEnvioId: method.formaEnvioId, formaFreteId: first.formaFreteId, serviceCode: first.serviceCode || code };
    }
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { order_id } = await req.json();
    if (!order_id) throw new Error('order_id is required');

    const FRENET_TOKEN = Deno.env.get('FRENET_TOKEN');
    const TINY_ERP_TOKEN = Deno.env.get('TINY_ERP_TOKEN');
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

    // Weight in kg (min 0.3)
    const totalWeightKg = Math.max(0.3, (order.total_weight_grams || 300) / 1000);
    const items = order.expedition_order_items || [];
    const totalQty = items.reduce((sum: number, i: any) => sum + i.quantity, 0);

    // Step 1: Fetch Tiny shipping methods (in parallel with Frenet quote)
    const tinyMethodsPromise = TINY_ERP_TOKEN
      ? fetchTinyShippingMethods(TINY_ERP_TOKEN)
      : Promise.resolve([]);

    // Step 2: Quote via Frenet
    const frenetBody = {
      SellerCEP: "01001000",
      RecipientCEP: shippingAddress.zip.replace(/\D/g, ''),
      ShipmentInvoiceValue: order.total_price || 0,
      ShippingItemArray: [{
        Height: Math.max(4, Math.ceil(totalQty * 5)),
        Length: 30,
        Width: 25,
        Weight: totalWeightKg,
        Quantity: 1,
        SKU: 'PACKAGE',
      }],
      RecipientCountry: 'BR',
    };

    const frenetQuotes: any[] = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      console.log('Quoting via Frenet...', JSON.stringify(frenetBody));
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
        const shippingServices = frenetData.ShippingSevicesArray || frenetData.ShippingServices || [];
        
        for (const svc of shippingServices) {
          if (svc.Error || svc.ShippingPrice <= 0) continue;
          frenetQuotes.push({
            carrier: svc.Carrier || 'Unknown',
            service: svc.ServiceDescription || svc.ServiceCode || 'Standard',
            serviceCode: svc.ServiceCode || '',
            price: parseFloat(svc.ShippingPrice || svc.OriginalShippingPrice || '0'),
            delivery_days: parseInt(svc.DeliveryTime || '0'),
          });
        }
      } else {
        const errText = await frenetResponse.text();
        console.error('Frenet error:', errText.substring(0, 300));
      }
    } catch (e) {
      clearTimeout(timeout);
      console.warn('Frenet request failed/timed out:', e.message);
    }

    // If no Frenet quotes, try Correios directly
    if (frenetQuotes.length === 0) {
      const CORREIOS_SENHA = Deno.env.get('CORREIOS_EMPRESA_SENHA');
      const CORREIOS_CODIGO = Deno.env.get('CORREIOS_EMPRESA_CODIGO');

      if (CORREIOS_SENHA) {
        const services = [
          { code: '03220', name: 'SEDEX' },
          { code: '03298', name: 'PAC' },
        ];

        const correiosPromises = services.map(async (svc) => {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15000);
          try {
            const url = `http://ws.correios.com.br/calculador/CalcPrecoPrazo.aspx?nCdEmpresa=${CORREIOS_CODIGO || ''}&sDsSenha=${CORREIOS_SENHA}&nCdServico=${svc.code}&sCepOrigem=01001000&sCepDestino=${shippingAddress.zip.replace(/\D/g, '')}&nVlPeso=${totalWeightKg}&nCdFormato=1&nVlComprimento=30&nVlAltura=${Math.max(4, Math.ceil(totalQty * 5))}&nVlLargura=25&nVlDiametro=0&sCdMaoPropria=N&nVlValorDeclarado=${order.total_price || 0}&sCdAvisoRecebimento=N&StrRetorno=xml&nIndicaCalculo=3`;
            const resp = await fetch(url, { signal: ctrl.signal });
            clearTimeout(t);
            const text = await resp.text();
            const priceMatch = text.match(/<Valor>([\d,.]+)<\/Valor>/);
            const daysMatch = text.match(/<PrazoEntrega>(\d+)<\/PrazoEntrega>/);
            const errorMatch = text.match(/<Erro>(\d+)<\/Erro>/);
            if (priceMatch && (!errorMatch || errorMatch[1] === '0')) {
              frenetQuotes.push({
                carrier: 'Correios',
                service: svc.name,
                serviceCode: svc.code,
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

    // Step 3: Wait for Tiny methods and cross-reference
    const tinyMethods = await tinyMethodsPromise;
    console.log(`Tiny methods loaded: ${tinyMethods.length} formas de envio`);

    // Build final quotes with Tiny IDs
    const quotes: any[] = [];

    for (const fq of frenetQuotes) {
      const tinyMatch = matchFrenetToTiny(fq.carrier, fq.service, fq.serviceCode, tinyMethods);
      
      quotes.push({
        expedition_order_id: order_id,
        carrier: fq.carrier,
        service: fq.service,
        price: fq.price,
        delivery_days: fq.delivery_days,
        tiny_forma_envio_id: tinyMatch?.formaEnvioId || null,
        tiny_forma_frete_id: tinyMatch?.formaFreteId || null,
        tiny_service_code: tinyMatch?.serviceCode || fq.serviceCode || null,
      });

      if (tinyMatch) {
        console.log(`Matched "${fq.carrier} ${fq.service}" → Tiny envio=${tinyMatch.formaEnvioId}, frete=${tinyMatch.formaFreteId}, code=${tinyMatch.serviceCode}`);
      } else {
        console.warn(`No Tiny match for "${fq.carrier} ${fq.service}" (code=${fq.serviceCode})`);
      }
    }

    // Always add manual carrier option
    quotes.push({
      expedition_order_id: order_id,
      carrier: 'Mototaxista 🏍️',
      service: 'Entrega Local',
      price: 0,
      delivery_days: 0,
      tiny_forma_envio_id: null,
      tiny_forma_frete_id: null,
      tiny_service_code: null,
    });

    console.log(`Total quotes: ${quotes.length}`);
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

    return new Response(JSON.stringify({ success: true, quotes, tiny_methods_count: tinyMethods.length }), {
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
