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
    const { request_id } = await req.json();
    if (!request_id) throw new Error('request_id is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get the transfer request
    const { data: request, error: reqError } = await supabase
      .from('pos_inter_store_requests')
      .select('*')
      .eq('id', request_id)
      .single();

    if (reqError || !request) throw new Error('Transfer request not found');

    const items = request.items as { product_name: string; sku: string; quantity: number; size?: string; color?: string; tiny_id?: number }[];

    // Get tokens for both stores
    const { data: stores, error: storesError } = await supabase
      .from('pos_stores')
      .select('id, name, tiny_token')
      .in('id', [request.from_store_id, request.to_store_id]);

    if (storesError || !stores || stores.length < 2) throw new Error('Could not find both stores');

    const originStore = stores.find(s => s.id === request.from_store_id);
    const destStore = stores.find(s => s.id === request.to_store_id);

    if (!originStore?.tiny_token || !destStore?.tiny_token) {
      throw new Error('Both stores must have Tiny tokens configured');
    }

    const results: { product_name: string; success: boolean; error?: string }[] = [];

    for (const item of items) {
      try {
        // We need the tiny_id. If not in the item, search by SKU in pos_products
        let tinyId = item.tiny_id;
        if (!tinyId && item.sku) {
          // Search in origin store products
          const { data: prod } = await supabase
            .from('pos_products')
            .select('tiny_id')
            .eq('sku', item.sku)
            .eq('store_id', request.from_store_id)
            .limit(1)
            .maybeSingle();
          tinyId = prod?.tiny_id;
        }

        if (!tinyId) {
          results.push({ product_name: item.product_name, success: false, error: 'Tiny ID not found for product' });
          continue;
        }

        // Get current stock from origin store and decrement
        const originStockResp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${originStore.tiny_token}&formato=json&id=${tinyId}`,
        });
        const originStockData = await originStockResp.json();
        const originCurrentStock = parseFloat(originStockData.retorno?.produto?.saldo || '0');
        const newOriginStock = Math.max(0, originCurrentStock - item.quantity);

        // Update origin stock (decrement)
        const originUpdateResp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${originStore.tiny_token}&formato=json&id=${tinyId}&estoque=${newOriginStock}`,
        });
        const originUpdateData = await originUpdateResp.json();

        if (originUpdateData.retorno?.status === 'Erro') {
          results.push({ product_name: item.product_name, success: false, error: `Origin: ${originUpdateData.retorno?.erros?.[0]?.erro || 'Unknown error'}` });
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        console.log(`Origin ${originStore.name}: ${item.product_name} ${originCurrentStock} → ${newOriginStock}`);
        await new Promise(r => setTimeout(r, 2000)); // Rate limit

        // Now search the product in dest store by SKU (may have different tiny_id)
        let destTinyId = tinyId;
        if (item.sku) {
          const { data: destProd } = await supabase
            .from('pos_products')
            .select('tiny_id')
            .eq('sku', item.sku)
            .eq('store_id', request.to_store_id)
            .limit(1)
            .maybeSingle();
          if (destProd?.tiny_id) destTinyId = destProd.tiny_id;
        }

        // Get current stock from dest store and increment
        const destStockResp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${destStore.tiny_token}&formato=json&id=${destTinyId}`,
        });
        const destStockData = await destStockResp.json();
        const destCurrentStock = parseFloat(destStockData.retorno?.produto?.saldo || '0');
        const newDestStock = destCurrentStock + item.quantity;

        // Update dest stock (increment)
        const destUpdateResp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${destStore.tiny_token}&formato=json&id=${destTinyId}&estoque=${newDestStock}`,
        });
        const destUpdateData = await destUpdateResp.json();

        if (destUpdateData.retorno?.status === 'Erro') {
          results.push({ product_name: item.product_name, success: false, error: `Dest: ${destUpdateData.retorno?.erros?.[0]?.erro || 'Unknown error'}` });
        } else {
          results.push({ product_name: item.product_name, success: true });
          console.log(`Dest ${destStore.name}: ${item.product_name} ${destCurrentStock} → ${newDestStock}`);
        }

        await new Promise(r => setTimeout(r, 2000)); // Rate limit
      } catch (e) {
        console.error(`Error for ${item.product_name}:`, e);
        results.push({ product_name: item.product_name, success: false, error: e.message });
      }
    }

    const allOk = results.every(r => r.success);
    return new Response(JSON.stringify({ success: allOk, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
