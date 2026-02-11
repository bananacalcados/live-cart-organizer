import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, sale_id, tiny_order_id } = await req.json();
    if (!store_id || !tiny_order_id) throw new Error('store_id and tiny_order_id are required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: store } = await supabase
      .from('pos_stores')
      .select('tiny_token')
      .eq('id', store_id)
      .single();

    if (!store?.tiny_token) throw new Error('Store token not configured');
    const token = store.tiny_token;

    // Generate NFC-e from order
    const resp = await fetch('https://api.tiny.com.br/api2/gerar.nota.fiscal.pedido.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&id=${tiny_order_id}&modelo=NFCe`,
    });

    const data = await resp.json();
    console.log('Tiny NFC-e response:', JSON.stringify(data));

    if (data.retorno?.status === 'OK' || data.retorno?.status === 'Processado') {
      const nfData = data.retorno?.registros?.registro || data.retorno?.registros;
      const invoiceId = nfData?.idNotaFiscal || nfData?.[0]?.idNotaFiscal || null;

      let invoiceDetails = {};

      if (invoiceId) {
        // Get invoice details
        const detailResp = await fetch('https://api.tiny.com.br/api2/nota.fiscal.obter.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&id=${invoiceId}`,
        });

        const detailData = await detailResp.json();
        const nf = detailData.retorno?.nota_fiscal || {};
        invoiceDetails = {
          invoice_number: nf.numero || null,
          invoice_series: nf.serie || null,
          invoice_key: nf.chave_acesso || null,
          invoice_pdf_url: nf.link_danfe || null,
          invoice_xml_url: nf.link_xml || null,
        };

        // Update sale if sale_id provided
        if (sale_id) {
          await supabase.from('pos_sales').update({
            tiny_invoice_id: String(invoiceId),
            nfce_number: nf.numero || null,
            nfce_key: nf.chave_acesso || null,
            nfce_pdf_url: nf.link_danfe || null,
          }).eq('id', sale_id);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        tiny_invoice_id: invoiceId,
        ...invoiceDetails,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const errorMsg = data.retorno?.erros?.[0]?.erro || JSON.stringify(data.retorno);
    throw new Error(`Tiny NFC-e error: ${errorMsg}`);
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
