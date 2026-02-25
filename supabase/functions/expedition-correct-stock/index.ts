import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Direct stock balance correction for a specific store via Tiny ERP API v2.
 * Receives: { sku, store_id, new_quantity }
 * Looks up the tiny_id from pos_products, gets the store's tiny_token,
 * and sends a balance (tipo B) update to Tiny.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sku, store_id, new_quantity } = await req.json();
    if (!sku || !store_id || new_quantity === undefined || new_quantity === null) {
      throw new Error('sku, store_id and new_quantity are required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get product's tiny_id and store's tiny_token + deposit name
    const { data: product, error: prodErr } = await supabase
      .from('pos_products')
      .select('tiny_id, stock, pos_stores:store_id(tiny_token, tiny_deposit_name, name)')
      .eq('sku', sku)
      .eq('store_id', store_id)
      .maybeSingle();

    if (prodErr) throw prodErr;
    if (!product) throw new Error(`Produto SKU ${sku} não encontrado na loja selecionada`);

    const store = (product as any).pos_stores;
    const token = store?.tiny_token;
    const depositName = store?.tiny_deposit_name;
    const storeName = store?.name;

    if (!token) throw new Error(`Token do Tiny não configurado para a loja ${storeName || store_id}`);
    if (!product.tiny_id) throw new Error(`Produto sem tiny_id para SKU ${sku}`);

    // Build XML for stock balance update (tipo B = balanço)
    let xml = `<estoque>
  <idProduto>${product.tiny_id}</idProduto>
  <tipo>B</tipo>
  <quantidade>${new_quantity}</quantidade>
  <observacoes>Correção de balanço via Expedição</observacoes>`;

    if (depositName) {
      xml += `\n  <deposito>${depositName}</deposito>`;
    }

    xml += `\n</estoque>`;

    console.log(`Correcting stock for SKU ${sku} (tiny_id ${product.tiny_id}) at ${storeName}: qty=${new_quantity}, deposit=${depositName || 'default'}`);

    const resp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&estoque=${encodeURIComponent(xml)}`,
    });

    const data = await resp.json();
    console.log('Tiny response:', JSON.stringify(data.retorno));

    if (data.retorno?.status === 'Erro') {
      const errMsg = data.retorno?.erros?.[0]?.erro || 'Erro desconhecido do Tiny';
      throw new Error(errMsg);
    }

    // Update local cache
    await supabase
      .from('pos_products')
      .update({ stock: new_quantity, updated_at: new Date().toISOString() })
      .eq('sku', sku)
      .eq('store_id', store_id);

    return new Response(JSON.stringify({
      success: true,
      previous_stock: product.stock,
      new_stock: new_quantity,
      store_name: storeName,
      deposit: depositName,
    }), {
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
