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

async function searchTinyOrderByNumber(token: string, orderNumber: string): Promise<string | null> {
  // Search by numero_ecommerce or numero
  for (const campo of [orderNumber]) {
    const response = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&numero=${encodeURIComponent(campo)}`,
    });
    const data = await safeJson(response, 'Pesquisa pedido Tiny');
    console.log(`Search Tiny for "${campo}":`, JSON.stringify(data));

    if (data.retorno?.status === 'OK' || data.retorno?.status === 'Processado') {
      const pedidos = data.retorno?.pedidos || [];
      if (pedidos.length > 0) {
        const pedido = pedidos[0]?.pedido || pedidos[0];
        return String(pedido.id);
      }
    }
  }

  // Also try searching by numero_ecommerce using pesquisa field
  const response = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${token}&formato=json&numeroEcommerce=${encodeURIComponent(orderNumber)}`,
  });
  const data = await safeJson(response, 'Pesquisa pedido Tiny (ecommerce)');
  console.log(`Search Tiny ecommerce "${orderNumber}":`, JSON.stringify(data));

  if (data.retorno?.status === 'OK' || data.retorno?.status === 'Processado') {
    const pedidos = data.retorno?.pedidos || [];
    if (pedidos.length > 0) {
      const pedido = pedidos[0]?.pedido || pedidos[0];
      return String(pedido.id);
    }
  }

  return null;
}

async function updateTinyOrderCustomerData(token: string, tinyOrderId: string, order: any) {
  const shippingAddress = order.shipping_address as any;

  // Build update payload with customer data including CPF
  const pedido: any = {
    cliente: {
      nome: order.customer_name || 'Cliente',
      email: order.customer_email || '',
      fone: order.customer_phone || '',
    },
  };

  // Add CPF if available
  if (order.customer_cpf) {
    pedido.cliente.cpf_cnpj = order.customer_cpf;
  }

  // Add address if available
  if (shippingAddress) {
    pedido.cliente.endereco = shippingAddress.address1 || '';
    pedido.cliente.complemento = shippingAddress.address2 || '';
    pedido.cliente.cidade = shippingAddress.city || '';
    pedido.cliente.uf = shippingAddress.province || '';
    pedido.cliente.cep = shippingAddress.zip?.replace(/\D/g, '') || '';
  }

  console.log(`Updating Tiny order ${tinyOrderId} with customer data:`, JSON.stringify(pedido));

  const response = await fetch('https://api.tiny.com.br/api2/pedido.alterar.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${token}&formato=json&id=${tinyOrderId}&pedido=${encodeURIComponent(JSON.stringify({ pedido }))}`,
  });
  const data = await safeJson(response, 'Alterar pedido Tiny');
  console.log('Update Tiny order response:', JSON.stringify(data));

  return data;
}

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

    // ACTION: sync_order - Find existing Tiny order and update customer data (CPF, etc.)
    // This replaces the old create_order action. Shopify orders are already auto-synced to Tiny.
    if (action === 'sync_order' || action === 'create_order') {
      const searchNumber = order.shopify_order_name || order.shopify_order_number;
      if (!searchNumber) throw new Error('Pedido sem número Shopify para buscar no Tiny');

      console.log(`Searching Tiny for order: ${searchNumber}`);
      let tinyOrderId = order.tiny_order_id;

      if (!tinyOrderId) {
        tinyOrderId = await searchTinyOrderByNumber(TINY_ERP_TOKEN, searchNumber);
      }

      if (!tinyOrderId) {
        throw new Error(
          `Pedido "${searchNumber}" não encontrado no Tiny ERP. ` +
          `Verifique se o pedido já foi sincronizado da Shopify para o Tiny. ` +
          `Aguarde alguns minutos e tente novamente.`
        );
      }

      // Save tiny_order_id
      await supabase
        .from('expedition_orders')
        .update({ tiny_order_id: tinyOrderId })
        .eq('id', order_id);

      // Update customer data (CPF, address, etc.) on the Tiny order
      const updateResult = await updateTinyOrderCustomerData(TINY_ERP_TOKEN, tinyOrderId, order);
      const updateOk = updateResult.retorno?.status === 'OK' || updateResult.retorno?.status === 'Processado';

      return new Response(JSON.stringify({
        success: true,
        tiny_order_id: tinyOrderId,
        customer_updated: updateOk,
        message: updateOk
          ? `Pedido localizado no Tiny (ID: ${tinyOrderId}) e dados do cliente atualizados com sucesso.`
          : `Pedido localizado (ID: ${tinyOrderId}), mas não foi possível atualizar dados do cliente.`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'emit_invoice') {
      // If we don't have tiny_order_id yet, search for it first
      if (!order.tiny_order_id) {
        const searchNumber = order.shopify_order_name || order.shopify_order_number;
        if (searchNumber) {
          const foundId = await searchTinyOrderByNumber(TINY_ERP_TOKEN, searchNumber);
          if (foundId) {
            await supabase
              .from('expedition_orders')
              .update({ tiny_order_id: foundId })
              .eq('id', order_id);
            order.tiny_order_id = foundId;

            // Also update CPF on Tiny order before emitting NF-e
            if (order.customer_cpf) {
              await updateTinyOrderCustomerData(TINY_ERP_TOKEN, foundId, order);
            }
          }
        }
      } else if (order.customer_cpf) {
        // Even if we already have tiny_order_id, ensure CPF is synced before NF-e
        await updateTinyOrderCustomerData(TINY_ERP_TOKEN, order.tiny_order_id, order);
      }

      if (!order.tiny_order_id) throw new Error('Pedido não encontrado no Tiny ERP. Clique em "Sincronizar com Tiny" primeiro.');

      // Check if freight was quoted first
      if (!order.freight_carrier || !order.freight_price) {
        throw new Error('O frete precisa ser cotado e selecionado antes de emitir a NF-e.');
      }

      // Emit NF-e from Tiny order
      const tinyResponse = await fetch(`https://api.tiny.com.br/api2/gerar.nota.fiscal.pedido.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${TINY_ERP_TOKEN}&formato=json&id=${order.tiny_order_id}&modelo=NFe`,
      });

      const tinyData = await safeJson(tinyResponse, 'Gerar NF-e');
      console.log('NF-e response:', JSON.stringify(tinyData));

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

          const detailData = await safeJson(detailResponse, 'Obter NF-e');
          const nf = detailData.retorno?.nota_fiscal || {};

          await supabase
            .from('expedition_orders')
            .update({
              tiny_invoice_id: String(invoiceId),
              invoice_number: nf.numero || null,
              invoice_series: nf.serie || null,
              invoice_key: nf.chave_acesso || null,
              invoice_pdf_url: nf.link_danfe || null,
              invoice_xml_url: nf.link_xml || null,
              expedition_status: 'invoice_issued',
            })
            .eq('id', order_id);

          return new Response(JSON.stringify({ success: true, invoice: nf, tiny_invoice_id: invoiceId }), {
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
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
