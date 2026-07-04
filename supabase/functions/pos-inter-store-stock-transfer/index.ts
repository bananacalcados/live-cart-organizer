import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface TransferItem {
  product_name: string;
  sku: string;
  quantity: number;
  size?: string;
  color?: string;
  barcode?: string;
}

// Encontra a linha do produto no estoque interno de uma loja e retorna {id, stock}.
async function findRow(supabase: any, storeId: string, item: TransferItem) {
  let query = supabase.from('pos_products').select('id, stock').eq('store_id', storeId);
  if (item.barcode) query = query.eq('barcode', item.barcode);
  else query = query.eq('sku', item.sku);
  const { data } = await query.order('stock', { ascending: false }).limit(1);
  return data?.[0] || null;
}

// Transferência entre lojas 100% interna (pos_products). NÃO usa Tiny.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { request_id } = await req.json();
    if (!request_id) throw new Error('request_id is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: request, error: reqError } = await supabase
      .from('pos_inter_store_requests')
      .select('*')
      .eq('id', request_id)
      .single();

    if (reqError || !request) throw new Error('Transfer request not found');

    const items = request.items as TransferItem[];

    const { data: stores, error: storesError } = await supabase
      .from('pos_stores')
      .select('id, name')
      .in('id', [request.from_store_id, request.to_store_id]);

    if (storesError || !stores || stores.length < 2) throw new Error('Could not find both stores');

    const originStore = stores.find((s: any) => s.id === request.from_store_id);
    const destStore = stores.find((s: any) => s.id === request.to_store_id);

    const results: { product_name: string; success: boolean; error?: string }[] = [];

    for (const item of items) {
      try {
        if (!item.sku && !item.barcode) {
          results.push({ product_name: item.product_name, success: false, error: 'Item sem sku/barcode' });
          continue;
        }

        // ORIGEM: decrementa
        const originRow = await findRow(supabase, request.from_store_id, item);
        if (!originRow) {
          results.push({ product_name: item.product_name, success: false, error: `Produto não encontrado na loja de origem (${originStore?.name})` });
          continue;
        }
        const newOriginStock = Math.max(0, Number(originRow.stock || 0) - item.quantity);
        const { error: originUpdErr } = await supabase
          .from('pos_products')
          .update({ stock: newOriginStock, updated_at: new Date().toISOString() })
          .eq('id', originRow.id);
        if (originUpdErr) {
          results.push({ product_name: item.product_name, success: false, error: `Origem: ${originUpdErr.message}` });
          continue;
        }
        console.log(`Origem ${originStore?.name} [interno]: ${item.product_name} -> ${newOriginStock}`);

        // DESTINO: incrementa (cria/atualiza a linha existente da loja destino)
        const destRow = await findRow(supabase, request.to_store_id, item);
        if (!destRow) {
          results.push({ product_name: item.product_name, success: false, error: `Origem ajustada, mas produto inexistente na loja destino (${destStore?.name})` });
          continue;
        }
        const newDestStock = Number(destRow.stock || 0) + item.quantity;
        const { error: destUpdErr } = await supabase
          .from('pos_products')
          .update({ stock: newDestStock, updated_at: new Date().toISOString() })
          .eq('id', destRow.id);
        if (destUpdErr) {
          results.push({ product_name: item.product_name, success: false, error: `Destino: ${destUpdErr.message}` });
        } else {
          results.push({ product_name: item.product_name, success: true });
          console.log(`Destino ${destStore?.name} [interno]: ${item.product_name} -> ${newDestStock}`);
        }
      } catch (e) {
        console.error(`Error for ${item.product_name}:`, e);
        results.push({ product_name: item.product_name, success: false, error: (e as Error).message });
      }
    }

    const allOk = results.every(r => r.success);
    return new Response(JSON.stringify({ success: allOk, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
