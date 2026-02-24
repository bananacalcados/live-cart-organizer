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

// Fetch the description of a Tiny forma de envio AND forma de frete by their numeric IDs
async function fetchFormaEnvioAndFreteDescricao(token: string, formaEnvioId: string, formaFreteId?: string | null): Promise<{ envioDesc: string; freteDesc: string }> {
  try {
    const resp = await fetch('https://api.tiny.com.br/api2/formas.envio.obter.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&idFormaEnvio=${formaEnvioId}`,
    });
    const data = await safeJson(resp, `Obter forma envio ${formaEnvioId}`);
    let envioDesc = '';
    let freteDesc = '';
    if (data.retorno?.status === 'OK' || data.retorno?.status === 'Processado') {
      const fe = data.retorno?.forma_envio || data.retorno?.formaEnvio || data.retorno || {};
      envioDesc = fe.descricao || fe.nome || '';
      console.log(`Forma envio ${formaEnvioId} description: "${envioDesc}"`);
      
      if (formaFreteId) {
        const fretesData = fe.formas_frete || fe.formasFrete || fe.fretes || fe.servicos || [];
        const fretesList = Array.isArray(fretesData) ? fretesData : [];
        for (const freteEntry of fretesList) {
          const ff = freteEntry?.forma_frete || freteEntry?.formaFrete || freteEntry;
          if (String(ff.id) === String(formaFreteId)) {
            freteDesc = ff.descricao || ff.nome || '';
            console.log(`Forma frete ${formaFreteId} description: "${freteDesc}"`);
            break;
          }
        }
      }
    }
    return { envioDesc, freteDesc };
  } catch (e) {
    console.warn(`Could not fetch forma envio/frete description for ${formaEnvioId}:`, e.message);
  }
  return { envioDesc: '', freteDesc: '' };
}

// Fallback: Map carrier name to Tiny's formaEnvio code (only used when tiny_forma_envio_id is not stored)
function mapCarrierToFormaEnvioFallback(carrier: string): string {
  const c = (carrier || '').toLowerCase();
  if (c.includes('correio') || c.includes('pac') || c.includes('sedex')) return 'C';
  if (c.includes('j&t') || c.includes('jt ') || c.includes('j&t')) return 'J';
  if (c.includes('jadlog')) return 'J';
  if (c.includes('moto')) return 'X';
  return 'T';
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

    // Use stored Tiny IDs - fetch DESCRIPTIONS for formaEnvio AND formaFrete
    let formaEnvioDesc = '';
    let formaFreteDesc = '';
    if (order.tiny_forma_envio_id) {
      const result = await fetchFormaEnvioAndFreteDescricao(TINY_ERP_TOKEN, order.tiny_forma_envio_id, order.tiny_forma_frete_id);
      formaEnvioDesc = result.envioDesc;
      formaFreteDesc = result.freteDesc;
    }
    if (!formaEnvioDesc) {
      const carrierLower = (order.freight_carrier || '').toLowerCase();
      if (carrierLower.includes('correio')) formaEnvioDesc = 'Correios via Frenet';
      else if (carrierLower.includes('jadlog')) formaEnvioDesc = 'Jadlog via Frenet';
      else if (carrierLower.includes('j&t') || carrierLower.includes('jet')) formaEnvioDesc = 'J&T Express via Frenet';
      else formaEnvioDesc = order.freight_carrier || 'Transportadora';
    }
    if (!formaFreteDesc) {
      // Fallback: use freight_service directly (e.g., "Sedex", "PAC", "Jadlog Package")
      formaFreteDesc = order.freight_service || order.freight_carrier || '';
    }
    const serviceCode = order.tiny_service_code || '';
    const weightKg = Math.max(0.3, (order.total_weight_grams || 300) / 1000);

    console.log(`Freight info: carrier="${order.freight_carrier}", formaEnvio="${formaEnvioDesc}" (from ID=${order.tiny_forma_envio_id}), formaFrete="${formaFreteDesc}" (from ID=${order.tiny_forma_frete_id}), serviceCode="${serviceCode}", weightKg=${weightKg}`);

    // Note: pedido.alterar.php does NOT support forma_envio/valor_frete fields.
    // Freight data is injected via nota.fiscal.incluir.php in the invoice step instead.

    const objectId = order.tiny_invoice_id;
    const objectType = 'notafiscal';

    // Step 1: Send NF-e to expedition (expedicao.liberar.objetos.php)
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

    const idExpedicao = expedition.id || expedition.idExpedicao || idExpedicaoFromSend;
    let trackingCode = expedition.codigoRastreamento || expedition.codigo_rastreamento || null;
    const carrier = expedition.formaEnvio || expedition.transportadora || null;

    console.log(`Expedition ID: ${idExpedicao}, Tracking: ${trackingCode}, Carrier: ${carrier}`);

    // Step 3: Create grouping (agrupamento) and conclude it to auto-purchase freight
    let idAgrupamento: string | null = null;
    let labelUrl: string | null = null;

    if (idExpedicao) {
      // 3a: Create grouping with this expedition
      console.log('Step 3a: Creating expedition grouping...');
      const groupResponse = await fetch('https://api.tiny.com.br/api2/expedicao.incluir.agrupamento.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${TINY_ERP_TOKEN}&formato=json&idsExpedicao=${idExpedicao}`,
      });
      const groupData = await safeJson(groupResponse, 'Incluir agrupamento');
      console.log('Grouping response:', JSON.stringify(groupData));

      if (groupData.retorno?.status === 'OK' || groupData.retorno?.status === 'Processado') {
        idAgrupamento = groupData.retorno?.idAgrupamento || null;
        console.log('Grouping ID:', idAgrupamento);
      } else {
        const groupErr = groupData.retorno?.erros?.[0]?.erro || '';
        console.warn('Grouping error (may already exist):', groupErr);
        // Try to extract existing grouping ID from expedition data
        idAgrupamento = expedition.idAgrupamento || groupData.retorno?.idAgrupamento || null;
      }

      // 3b: Update expedition with packaging data AND freight service code
      console.log('Step 3b: Updating expedition with packaging + freight data...');
      const expeditionUpdatePayload = JSON.stringify({
        expedicao: {
          id: idExpedicao,
          pesoBruto: Number(weightKg.toFixed(3)),
          qtdVolumes: 1,
          formaEnvio: formaEnvioDesc,
          formaFrete: formaFreteDesc,
          codigoServico: serviceCode,
          embalagem: {
            tipo: 2, // pacote/caixa
            altura: 10,
            largura: 20,
            comprimento: 30,
          },
        },
      });
      console.log('Expedition update payload:', expeditionUpdatePayload);
      const updateExpResp = await fetch('https://api.tiny.com.br/api2/expedicao.alterar.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${TINY_ERP_TOKEN}&formato=json&expedicao=${encodeURIComponent(expeditionUpdatePayload)}`,
      });
      const updateExpData = await safeJson(updateExpResp, 'Alterar expedição');
      console.log('Update expedition response:', JSON.stringify(updateExpData));

      // Verify that formaFrete was actually set
      const updatedExp = updateExpData.retorno?.expedicao;
      if (updatedExp) {
        const ffId = updatedExp.formaFrete?.id || updatedExp.formaFrete;
        const ffDesc = updatedExp.formaFrete?.descricao || '';
        console.log(`After update - formaEnvio: ${updatedExp.formaEnvio}, formaFrete id: ${ffId}, desc: ${ffDesc}, pesoBruto: ${updatedExp.pesoBruto}`);
        
        if ((!ffId || ffId === 0 || ffId === '0') && (!ffDesc || ffDesc === '')) {
          console.warn('WARNING: formaFrete still empty after update. Tiny may not recognize the service code.');
        }
      }

      // 3c: Conclude the grouping (this auto-purchases freight/label)
      if (idAgrupamento) {
        console.log('Step 3c: Concluding expedition grouping (auto-purchases freight)...');
        const concludeResponse = await fetch('https://api.tiny.com.br/api2/expedicao.concluir.agrupamento.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${TINY_ERP_TOKEN}&formato=json&idAgrupamento=${idAgrupamento}`,
        });
        const concludeData = await safeJson(concludeResponse, 'Concluir agrupamento');
        console.log('Conclude response:', JSON.stringify(concludeData));

        if (concludeData.retorno?.status === 'OK' || concludeData.retorno?.status === 'Processado') {
          console.log('Expedition grouping concluded successfully - freight purchased automatically');
        } else {
          const concludeErr = concludeData.retorno?.erros?.[0]?.erro || '';
          console.warn('Conclude error:', concludeErr);
        }

        // Wait a moment for Tiny to process the freight purchase
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Step 4: Fetch labels (try by agrupamento first, then by expedition)
      console.log('Step 4: Fetching labels...');
      
      if (idAgrupamento) {
        const labelByGroupResp = await fetch('https://api.tiny.com.br/api2/expedicao.obter.etiquetas.impressao.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${TINY_ERP_TOKEN}&formato=json&idAgrupamento=${idAgrupamento}`,
        });
        const labelByGroupData = await safeJson(labelByGroupResp, 'Obter etiquetas (agrupamento)');
        console.log('Label by group data:', JSON.stringify(labelByGroupData));

        if (labelByGroupData.retorno?.status === 'OK' || labelByGroupData.retorno?.status === 'Processado') {
          const links = labelByGroupData.retorno?.links || labelByGroupData.retorno?.etiquetas || [];
          if (Array.isArray(links) && links.length > 0) {
            labelUrl = links[0]?.link || links[0]?.url || links[0] || null;
          } else if (typeof links === 'string') {
            labelUrl = links;
          }
        }
      }

      // Fallback: try by expedition ID
      if (!labelUrl) {
        const labelResponse = await fetch('https://api.tiny.com.br/api2/expedicao.obter.etiquetas.impressao.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${TINY_ERP_TOKEN}&formato=json&idExpedicao=${idExpedicao}`,
        });
        const labelData = await safeJson(labelResponse, 'Obter etiquetas (expedição)');
        console.log('Label by expedition data:', JSON.stringify(labelData));

        if (labelData.retorno?.status === 'OK' || labelData.retorno?.status === 'Processado') {
          const links = labelData.retorno?.links || labelData.retorno?.etiquetas || [];
          if (Array.isArray(links) && links.length > 0) {
            labelUrl = links[0]?.link || links[0]?.url || links[0] || null;
          } else if (typeof links === 'string') {
            labelUrl = links;
          }
        }
      }

      // Also re-fetch expedition to get tracking code if it was updated
      if (!trackingCode) {
        const recheck = await fetch('https://api.tiny.com.br/api2/expedicao.obter.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${TINY_ERP_TOKEN}&formato=json&tipoObjeto=${objectType}&idObjeto=${objectId}`,
        });
        const recheckData = await safeJson(recheck, 'Re-obter expedição');
        const recheckExp = recheckData.retorno?.expedicao;
        if (recheckExp) {
          trackingCode = recheckExp.codigoRastreamento || recheckExp.codigo_rastreamento || trackingCode;
        }
      }
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
      grouping_id: idAgrupamento,
      message: hasLabel
        ? 'Etiqueta oficial obtida com sucesso!'
        : trackingCode
          ? 'Expedição concluída e frete comprado. A etiqueta pode levar alguns instantes para ficar disponível. Tente novamente em breve.'
          : 'Expedição enviada ao Tiny, mas a etiqueta ainda não foi gerada. Verifique se a forma de frete está configurada no Tiny e tente novamente.',
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
