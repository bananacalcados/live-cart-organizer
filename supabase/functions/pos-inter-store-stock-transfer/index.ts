import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function safeJson(resp: Response) {
  return resp.text().then(t => {
    try { return JSON.parse(t); } catch { return { retorno: { status: 'Erro', erros: [{ erro: t.substring(0, 200) }] } }; }
  });
}

function getDepositStock(stockData: any, depositName: string): number {
  if (!depositName) {
    return parseFloat(stockData.retorno?.produto?.saldo || '0');
  }
  const depositos = stockData.retorno?.produto?.depositos || [];
  for (const dep of depositos) {
    const d = dep.deposito || dep;
    if (d.nome === depositName) {
      return parseFloat(d.saldo || '0');
    }
  }
  return 0;
}

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

    // Get tokens AND deposit names for both stores
    const { data: stores, error: storesError } = await supabase
      .from('pos_stores')
      .select('id, name, tiny_token, tiny_deposit_name')
      .in('id', [request.from_store_id, request.to_store_id]);

    if (storesError || !stores || stores.length < 2) throw new Error('Could not find both stores');

    const originStore = stores.find(s => s.id === request.from_store_id);
    const destStore = stores.find(s => s.id === request.to_store_id);

    if (!originStore?.tiny_token || !destStore?.tiny_token) {
      throw new Error('Both stores must have Tiny tokens configured');
    }

    const originDeposit = originStore.tiny_deposit_name || '';
    const destDeposit = destStore.tiny_deposit_name || '';

    const results: { product_name: string; success: boolean; error?: string }[] = [];

    for (const item of items) {
      try {
        // Resolve tiny_id
        let tinyId = item.tiny_id;
        if (!tinyId && item.sku) {
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

        // --- ORIGIN: decrement stock ---
        const originStockResp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${originStore.tiny_token}&formato=json&id=${tinyId}`,
        });
        const originStockData = await safeJson(originStockResp);
        const originCurrentStock = getDepositStock(originStockData, originDeposit);
        const newOriginStock = Math.max(0, originCurrentStock - item.quantity);

        // Update origin using JSON format with tipo=B and deposit
        const originJson = JSON.stringify({ estoque: {
          idProduto: Number(tinyId), tipo: 'B', quantidade: String(newOriginStock),
          ...(originDeposit ? { nome_deposito: originDeposit } : {}),
          observacoes: `Transferencia para ${destStore.name}: -${item.quantity}`,
        }});
        const originForm = new URLSearchParams();
        originForm.set('token', originStore.tiny_token);
        originForm.set('formato', 'json');
        originForm.set('estoque', originJson);

        const originUpdateResp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: originForm.toString(),
        });
        const originUpdateData = await safeJson(originUpdateResp);

        if (originUpdateData.retorno?.status === 'Erro') {
          results.push({ product_name: item.product_name, success: false, error: `Origin: ${originUpdateData.retorno?.erros?.[0]?.erro || 'Unknown error'}` });
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        console.log(`Origin ${originStore.name} [${originDeposit}]: ${item.product_name} ${originCurrentStock} → ${newOriginStock}`);
        await new Promise(r => setTimeout(r, 2000)); // Rate limit

        // --- DEST: increment stock ---
        // Find product in dest store (may have different tiny_id)
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

        const destStockResp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${destStore.tiny_token}&formato=json&id=${destTinyId}`,
        });
        const destStockData = await safeJson(destStockResp);
        const destCurrentStock = getDepositStock(destStockData, destDeposit);
        const newDestStock = destCurrentStock + item.quantity;

        // Update dest using JSON format with tipo=B and deposit
        const destJson = JSON.stringify({ estoque: {
          idProduto: Number(destTinyId), tipo: 'B', quantidade: String(newDestStock),
          ...(destDeposit ? { nome_deposito: destDeposit } : {}),
          observacoes: `Transferencia de ${originStore.name}: +${item.quantity}`,
        }});
        const destForm = new URLSearchParams();
        destForm.set('token', destStore.tiny_token);
        destForm.set('formato', 'json');
        destForm.set('estoque', destJson);

        const destUpdateResp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: destForm.toString(),
        });
        const destUpdateData = await safeJson(destUpdateResp);

        if (destUpdateData.retorno?.status === 'Erro') {
          results.push({ product_name: item.product_name, success: false, error: `Dest: ${destUpdateData.retorno?.erros?.[0]?.erro || 'Unknown error'}` });
        } else {
          results.push({ product_name: item.product_name, success: true });
          console.log(`Dest ${destStore.name} [${destDeposit}]: ${item.product_name} ${destCurrentStock} → ${newDestStock}`);
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
