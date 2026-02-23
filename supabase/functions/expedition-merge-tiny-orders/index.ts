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
    throw new Error(`${label}: resposta inválida da API Tiny - \"${text.substring(0, 100)}\"`);
  }
}

async function getTinyOrder(token: string, tinyOrderId: string) {
  const response = await fetch('https://api.tiny.com.br/api2/pedido.obter.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${token}&formato=json&id=${tinyOrderId}`,
  });
  const data = await safeJson(response, 'Obter pedido Tiny');
  if (data.retorno?.status !== 'OK' && data.retorno?.status !== 'Processado') {
    throw new Error(`Erro ao obter pedido Tiny ${tinyOrderId}: ${JSON.stringify(data.retorno?.erros)}`);
  }
  return data.retorno?.pedido;
}

async function searchTinyOrderByNumber(token: string, orderNumber: string): Promise<string | null> {
  for (const field of ['numero', 'numeroEcommerce']) {
    const response = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&${field}=${encodeURIComponent(orderNumber)}`,
    });
    const data = await safeJson(response, `Pesquisa pedido Tiny (${field})`);
    if (data.retorno?.status === 'OK' || data.retorno?.status === 'Processado') {
      const pedidos = data.retorno?.pedidos || [];
      if (pedidos.length > 0) {
        const pedido = pedidos[0]?.pedido || pedidos[0];
        return String(pedido.id);
      }
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { keep_order_id, merge_order_ids } = await req.json();
    if (!keep_order_id || !merge_order_ids?.length) {
      throw new Error('keep_order_id and merge_order_ids are required');
    }

    const TINY_ERP_TOKEN = Deno.env.get('TINY_ERP_TOKEN');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!TINY_ERP_TOKEN) throw new Error('TINY_ERP_TOKEN not configured');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 1. Load all expedition orders
    const allIds = [keep_order_id, ...merge_order_ids];
    const { data: expOrders, error: expErr } = await supabase
      .from('expedition_orders')
      .select('*, expedition_order_items(*)')
      .in('id', allIds);
    if (expErr || !expOrders) throw new Error('Erro ao buscar pedidos: ' + expErr?.message);

    const keepOrder = expOrders.find(o => o.id === keep_order_id);
    const mergeOrders = expOrders.filter(o => merge_order_ids.includes(o.id));
    if (!keepOrder) throw new Error('Pedido principal não encontrado');
    if (mergeOrders.length === 0) throw new Error('Nenhum pedido para mesclar');

    // 2. Ensure all orders have tiny_order_id
    for (const order of [keepOrder, ...mergeOrders]) {
      if (!order.tiny_order_id) {
        const searchNum = order.shopify_order_name || order.shopify_order_number;
        if (searchNum) {
          const foundId = await searchTinyOrderByNumber(TINY_ERP_TOKEN, searchNum);
          if (foundId) {
            await supabase.from('expedition_orders').update({ tiny_order_id: foundId }).eq('id', order.id);
            order.tiny_order_id = foundId;
          }
        }
      }
      if (!order.tiny_order_id) {
        throw new Error(`Pedido ${order.shopify_order_name} não encontrado no Tiny. Sincronize primeiro.`);
      }
    }

    // 3. Get the keep order from Tiny to get its current items
    console.log(`Getting keep order from Tiny: ${keepOrder.tiny_order_id}`);
    const tinyKeepOrder = await getTinyOrder(TINY_ERP_TOKEN, keepOrder.tiny_order_id);
    const existingItems = tinyKeepOrder?.itens || [];

    // 4. Collect items from merge orders
    const newItems: any[] = [];
    for (const mergeOrder of mergeOrders) {
      const tinyMergeOrder = await getTinyOrder(TINY_ERP_TOKEN, mergeOrder.tiny_order_id);
      const mergeItems = tinyMergeOrder?.itens || [];
      for (const itemWrapper of mergeItems) {
        const item = itemWrapper.item || itemWrapper;
        newItems.push({
          item: {
            descricao: item.descricao,
            unidade: item.unidade || 'UN',
            quantidade: item.quantidade,
            valor_unitario: item.valor_unitario,
            codigo: item.codigo || '',
          }
        });
      }
    }

    if (newItems.length === 0) {
      throw new Error('Nenhum item encontrado nos pedidos a serem mesclados');
    }

    // 5. Build updated order with all items combined
    const allItems = [...existingItems, ...newItems];

    // Update the keep order in Tiny with all items
    const updatePayload = {
      pedido: {
        id: keepOrder.tiny_order_id,
        itens: allItems,
      }
    };

    console.log('Updating Tiny order with merged items:', JSON.stringify(updatePayload));
    const updateResponse = await fetch('https://api.tiny.com.br/api2/pedido.alterar.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${TINY_ERP_TOKEN}&formato=json&pedido=${encodeURIComponent(JSON.stringify(updatePayload.pedido))}`,
    });
    const updateData = await safeJson(updateResponse, 'Alterar pedido Tiny');
    console.log('Update Tiny order response:', JSON.stringify(updateData));

    if (updateData.retorno?.status !== 'OK' && updateData.retorno?.status !== 'Processado') {
      const errMsg = updateData.retorno?.erros?.[0]?.erro || JSON.stringify(updateData.retorno);
      throw new Error(`Erro ao atualizar pedido no Tiny: ${errMsg}`);
    }

    // 6. Delete/cancel the merged orders in Tiny
    const deletedTinyOrders: string[] = [];
    for (const mergeOrder of mergeOrders) {
      try {
        // Try to cancel the order first (safer than deleting)
        const cancelResponse = await fetch('https://api.tiny.com.br/api2/pedido.alterar.situacao.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${TINY_ERP_TOKEN}&formato=json&id=${mergeOrder.tiny_order_id}&situacao=cancelado`,
        });
        const cancelData = await safeJson(cancelResponse, 'Cancelar pedido Tiny');
        console.log(`Cancel Tiny order ${mergeOrder.tiny_order_id}:`, JSON.stringify(cancelData));
        deletedTinyOrders.push(mergeOrder.tiny_order_id);
      } catch (e: any) {
        console.error(`Failed to cancel Tiny order ${mergeOrder.tiny_order_id}:`, e.message);
      }
    }

    // 7. Update DB: move items from merged orders to keep order
    for (const mergeOrder of mergeOrders) {
      const mergeItems = mergeOrder.expedition_order_items || [];
      for (const item of mergeItems) {
        await supabase.from('expedition_order_items')
          .update({ expedition_order_id: keep_order_id })
          .eq('id', item.id);
      }

      // Mark merged order as cancelled/merged
      await supabase.from('expedition_orders')
        .update({
          expedition_status: 'merged',
          notes: `Mesclado no pedido ${keepOrder.shopify_order_name} (ID: ${keep_order_id})`,
        })
        .eq('id', mergeOrder.id);
    }

    // 8. Reset invoice data on keep order since items changed
    await supabase.from('expedition_orders')
      .update({
        tiny_invoice_id: null,
        invoice_number: null,
        invoice_series: null,
        invoice_key: null,
        invoice_pdf_url: null,
        invoice_xml_url: null,
        expedition_status: keepOrder.expedition_status === 'invoice_issued' ? 'freight_quoted' : keepOrder.expedition_status,
      })
      .eq('id', keep_order_id);

    return new Response(JSON.stringify({
      success: true,
      keep_order: keepOrder.shopify_order_name,
      merged_orders: mergeOrders.map(o => o.shopify_order_name),
      items_added: newItems.length,
      tiny_orders_cancelled: deletedTinyOrders,
      message: `${newItems.length} itens mesclados no pedido ${keepOrder.shopify_order_name}. ${deletedTinyOrders.length} pedido(s) cancelado(s) no Tiny.`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error merging orders:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
