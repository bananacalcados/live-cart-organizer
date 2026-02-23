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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { order_id } = await req.json();
    if (!order_id) throw new Error('order_id is required');

    const TINY_ERP_TOKEN = Deno.env.get('TINY_ERP_TOKEN');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TINY_ERP_TOKEN) throw new Error('TINY_ERP_TOKEN not configured');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('expedition_orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (orderError || !order) throw new Error('Order not found');

    // Validate prerequisites
    if (!order.tiny_invoice_id && !order.invoice_number) {
      return new Response(JSON.stringify({
        success: false,
        error: 'A NF-e precisa ser emitida antes de gerar a etiqueta de envio. Fluxo correto: Cotar Frete → Emitir NF-e → Gerar Etiqueta.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!order.freight_carrier) {
      return new Response(JSON.stringify({
        success: false,
        error: 'O frete precisa ser cotado e selecionado antes de gerar a etiqueta.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const objectId = order.tiny_invoice_id;
    const objectType = 'notafiscal';

    // Step 1: Send NF-e to expedition (correct endpoint: expedicao.liberar.objetos.php)
    console.log(`Step 1: Sending ${objectType} ${objectId} to expedition...`);
    const sendResponse = await fetch('https://api.tiny.com.br/api2/expedicao.liberar.objetos.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${TINY_ERP_TOKEN}&formato=json&tipoObjetos=${objectType}&idObjetos=${objectId}`,
    });
    const sendData = await safeJson(sendResponse, 'Envio para expedição');
    console.log('Send to expedition response:', JSON.stringify(sendData));

    // Extract idExpedicao from send response if available
    let idExpedicaoFromSend: string | null = null;
    if (sendData.retorno?.status === 'Erro') {
      const errMsg = sendData.retorno?.erros?.[0]?.erro || JSON.stringify(sendData.retorno);
      console.log('Send to expedition error (may be already sent):', errMsg);
    } else {
      const objetos = sendData.retorno?.objetos || [];
      if (objetos.length > 0) {
        idExpedicaoFromSend = objetos[0]?.objeto?.idExpedicao || null;
        console.log('Expedition ID from send:', idExpedicaoFromSend);
      }
    }

    // Step 2: Get expedition info
    console.log('Step 2: Getting expedition info...');
    const expeditionResponse = await fetch('https://api.tiny.com.br/api2/expedicao.obter.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${TINY_ERP_TOKEN}&formato=json&tipoObjeto=${objectType}&idObjeto=${objectId}`,
    });
    const expeditionData = await safeJson(expeditionResponse, 'Obter expedição');
    console.log('Expedition data:', JSON.stringify(expeditionData));

    if (expeditionData.retorno?.status !== 'OK' && expeditionData.retorno?.status !== 'Processado') {
      const err = expeditionData.retorno?.erros?.[0]?.erro || JSON.stringify(expeditionData.retorno);
      return new Response(JSON.stringify({
        success: false,
        error: `Expedição não encontrada no Tiny. O processamento pode demorar alguns segundos após o envio da NF-e. Tente novamente.`,
        details: err,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const expedition = expeditionData.retorno?.expedicao;
    if (!expedition) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Expedição criada mas dados ainda não disponíveis. Tente novamente em alguns segundos.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const idExpedicao = expedition.id || expedition.idExpedicao;
    const trackingCode = expedition.codigoRastreamento || expedition.codigo_rastreamento || null;
    const carrier = expedition.formaEnvio || expedition.transportadora || null;

    console.log(`Expedition ID: ${idExpedicao}, Tracking: ${trackingCode}, Carrier: ${carrier}`);

    // Step 3: Get label URLs
    console.log('Step 3: Fetching labels...');
    const labelResponse = await fetch('https://api.tiny.com.br/api2/expedicao.obter.etiquetas.impressao.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${TINY_ERP_TOKEN}&formato=json&idExpedicao=${idExpedicao}`,
    });
    const labelData = await safeJson(labelResponse, 'Obter etiquetas');
    console.log('Label data:', JSON.stringify(labelData));

    let labelUrl: string | null = null;

    if (labelData.retorno?.status === 'OK' || labelData.retorno?.status === 'Processado') {
      const links = labelData.retorno?.links || labelData.retorno?.etiquetas || [];
      if (Array.isArray(links) && links.length > 0) {
        labelUrl = links[0]?.link || links[0]?.url || links[0] || null;
      } else if (typeof links === 'string') {
        labelUrl = links;
      }
    } else {
      console.warn('Could not fetch labels:', JSON.stringify(labelData.retorno));
    }

    // Update order with label info
    const updateData: Record<string, unknown> = {};
    if (labelUrl) updateData.freight_label_url = labelUrl;
    if (trackingCode) updateData.freight_tracking_code = trackingCode;
    if (carrier && !order.freight_carrier) updateData.freight_carrier = carrier;
    if (labelUrl) updateData.expedition_status = 'label_generated';

    if (Object.keys(updateData).length > 0) {
      await supabase
        .from('expedition_orders')
        .update(updateData)
        .eq('id', order_id);
    }

    const hasLabel = !!labelUrl;
    return new Response(JSON.stringify({
      success: hasLabel,
      label_url: labelUrl,
      tracking_code: trackingCode,
      expedition_id: idExpedicao,
      message: hasLabel
        ? 'Etiqueta oficial obtida com sucesso!'
        : 'Expedição criada no Tiny, mas a etiqueta ainda não foi gerada pela transportadora. Tente buscar novamente em alguns instantes.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching label:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
