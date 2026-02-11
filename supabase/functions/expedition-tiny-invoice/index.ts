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
    const { order_id, action } = await req.json();
    if (!order_id) throw new Error('order_id is required');

    const TINY_ERP_TOKEN = Deno.env.get('TINY_ERP_TOKEN');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TINY_ERP_TOKEN) throw new Error('TINY_ERP_TOKEN not configured');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: order, error: orderError } = await supabase
      .from('expedition_orders')
      .select('*, expedition_order_items(*)')
      .eq('id', order_id)
      .single();

    if (orderError || !order) throw new Error('Order not found');

    if (action === 'create_order') {
      // Create order in Tiny ERP
      const shippingAddress = order.shipping_address as any;
      const items = order.expedition_order_items || [];

      const tinyOrder = {
        pedido: {
          numero_ecommerce: order.shopify_order_name || order.shopify_order_number,
          situacao: 'aprovado',
          data_pedido: new Date(order.shopify_created_at || order.created_at).toLocaleDateString('pt-BR'),
          cliente: {
            nome: order.customer_name || 'Cliente',
            email: order.customer_email || '',
            cpf_cnpj: order.customer_cpf || '',
            fone: order.customer_phone || '',
            endereco: shippingAddress?.address1 || '',
            complemento: shippingAddress?.address2 || '',
            cidade: shippingAddress?.city || '',
            uf: shippingAddress?.province || '',
            cep: shippingAddress?.zip?.replace(/\D/g, '') || '',
          },
          itens: items.map((item: any) => ({
            item: {
              codigo: item.sku || '',
              descricao: `${item.product_name}${item.variant_name ? ` - ${item.variant_name}` : ''}`,
              unidade: 'UN',
              quantidade: item.quantity,
              valor_unitario: item.unit_price,
            }
          })),
          valor_frete: order.total_shipping || 0,
          valor_desconto: order.total_discount || 0,
        }
      };

      const tinyResponse = await fetch(`https://api.tiny.com.br/api2/pedido.incluir.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${TINY_ERP_TOKEN}&formato=json&pedido=${encodeURIComponent(JSON.stringify(tinyOrder))}`,
      });

      const tinyData = await tinyResponse.json();

      if (tinyData.retorno?.status === 'OK' || tinyData.retorno?.status === 'Processado') {
        const records = tinyData.retorno?.registros?.registro || tinyData.retorno?.registros;
        const tinyOrderId = records?.id || records?.[0]?.id || null;

        await supabase
          .from('expedition_orders')
          .update({ tiny_order_id: String(tinyOrderId) })
          .eq('id', order_id);

        return new Response(JSON.stringify({ success: true, tiny_order_id: tinyOrderId }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        const errorMsg = tinyData.retorno?.erros?.[0]?.erro || JSON.stringify(tinyData.retorno);
        throw new Error(`Tiny ERP error: ${errorMsg}`);
      }
    }

    if (action === 'emit_invoice') {
      if (!order.tiny_order_id) throw new Error('Order not registered in Tiny ERP yet');

      // Emit NF-e from Tiny order
      const tinyResponse = await fetch(`https://api.tiny.com.br/api2/gerar.nota.fiscal.pedido.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${TINY_ERP_TOKEN}&formato=json&id=${order.tiny_order_id}&modelo=NFe`,
      });

      const tinyData = await tinyResponse.json();

      if (tinyData.retorno?.status === 'OK' || tinyData.retorno?.status === 'Processado') {
        const nfData = tinyData.retorno?.registros?.registro || tinyData.retorno?.registros;
        const invoiceId = nfData?.idNotaFiscal || nfData?.[0]?.idNotaFiscal || null;

        if (invoiceId) {
          // Get invoice details
          const detailResponse = await fetch(`https://api.tiny.com.br/api2/nota.fiscal.obter.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `token=${TINY_ERP_TOKEN}&formato=json&id=${invoiceId}`,
          });

          const detailData = await detailResponse.json();
          const nf = detailData.retorno?.nota_fiscal || {};

          await supabase
            .from('expedition_orders')
            .update({
              invoice_number: nf.numero || null,
              invoice_series: nf.serie || null,
              invoice_key: nf.chave_acesso || null,
              invoice_pdf_url: nf.link_danfe || null,
              invoice_xml_url: nf.link_xml || null,
              expedition_status: 'invoice_issued',
            })
            .eq('id', order_id);

          return new Response(JSON.stringify({ success: true, invoice: nf }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const errorMsg = tinyData.retorno?.erros?.[0]?.erro || JSON.stringify(tinyData.retorno);
      throw new Error(`Tiny NF-e error: ${errorMsg}`);
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error('Error with Tiny ERP:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
