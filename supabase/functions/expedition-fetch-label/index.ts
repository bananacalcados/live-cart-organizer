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
    if (!order.tiny_order_id) throw new Error('Pedido não cadastrado no Tiny ERP. Crie o pedido no Tiny primeiro.');

    // Step 1: Get expedition info for this order (tipoObjeto=venda)
    const expeditionResponse = await fetch('https://api.tiny.com.br/api2/expedicao.obter.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${TINY_ERP_TOKEN}&formato=json&tipoObjeto=venda&idObjeto=${order.tiny_order_id}`,
    });

    const expeditionData = await expeditionResponse.json();
    console.log('Expedition data:', JSON.stringify(expeditionData));

    if (expeditionData.retorno?.status !== 'OK' && expeditionData.retorno?.status !== 'Processado') {
      const err = expeditionData.retorno?.erros?.[0]?.erro || JSON.stringify(expeditionData.retorno);
      // Return 200 with user-friendly error instead of 500
      return new Response(JSON.stringify({
        success: false,
        error: `Expedição não encontrada no Tiny para este pedido. Verifique se a expedição foi criada e a etiqueta comprada no Tiny ERP.`,
        details: err,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const expedition = expeditionData.retorno?.expedicao;
    if (!expedition) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Nenhuma expedição encontrada para este pedido no Tiny. Crie a expedição e compre a etiqueta no Tiny ERP primeiro.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const idExpedicao = expedition.id || expedition.idExpedicao;
    const trackingCode = expedition.codigoRastreamento || expedition.codigo_rastreamento || null;
    const carrier = expedition.formaEnvio || expedition.transportadora || null;

    // Step 2: Get label URLs from expedition
    const labelResponse = await fetch('https://api.tiny.com.br/api2/expedicao.obter.etiquetas.impressao.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${TINY_ERP_TOKEN}&formato=json&idExpedicao=${idExpedicao}`,
    });

    const labelData = await labelResponse.json();
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
    const updateData: any = {};
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

    return new Response(JSON.stringify({
      success: true,
      label_url: labelUrl,
      tracking_code: trackingCode,
      expedition_id: idExpedicao,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching label:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
