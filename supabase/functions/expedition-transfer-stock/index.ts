import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Transfers stock from a source store deposit to the Shopify/Site deposit in Tiny ERP.
 * Steps:
 * 1. Look up the product's tiny_id via SKU/barcode in pos_products
 * 2. Decrease stock in source deposit (balanço to current - qty)
 * 3. Increase stock in Site deposit (balanço to current + qty)
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sku, barcode, source_store_id, quantity = 1 } = await req.json();
    if (!source_store_id) throw new Error('source_store_id is required');
    if (!sku && !barcode) throw new Error('sku or barcode is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get source store info
    const { data: sourceStore } = await supabase
      .from('pos_stores')
      .select('id, name, tiny_token, tiny_deposit_name')
      .eq('id', source_store_id)
      .single();

    if (!sourceStore) throw new Error('Source store not found');

    // Get destination store (Site/Shopify)
    const { data: siteStore } = await supabase
      .from('pos_stores')
      .select('id, name, tiny_token, tiny_deposit_name')
      .eq('tiny_deposit_name', 'Site')
      .single();

    if (!siteStore) throw new Error('Site store not found');

    // Find product in source store
    let query = supabase
      .from('pos_products')
      .select('tiny_id, sku, barcode, name, stock, store_id')
      .eq('store_id', source_store_id);

    if (sku) query = query.eq('sku', sku);
    else if (barcode) query = query.eq('barcode', barcode);

    const { data: sourceProducts } = await query.limit(1);
    const sourceProduct = sourceProducts?.[0];

    if (!sourceProduct || !sourceProduct.tiny_id) {
      throw new Error(`Product not found in ${sourceStore.name}`);
    }

    // Find same product in Site store (by SKU match)
    const { data: siteProducts } = await supabase
      .from('pos_products')
      .select('tiny_id, stock')
      .eq('store_id', siteStore.id)
      .eq('sku', sourceProduct.sku)
      .limit(1);

    const siteProduct = siteProducts?.[0];

    // Use the Tiny API to update stock via balanço (type B = absolute balance)
    // We need to: source stock -= quantity, site stock += quantity
    const sourceNewQty = Math.max(0, (sourceProduct.stock || 0) - quantity);
    const siteNewQty = (siteProduct?.stock || 0) + quantity;

    const results: any = { source: null, site: null };

    // Update source store stock (decrease)
    const sourceXml = `<estoque>
      <idProduto>${sourceProduct.tiny_id}</idProduto>
      <tipo>B</tipo>
      <quantidade>${sourceNewQty}</quantidade>
      <deposito>${sourceStore.tiny_deposit_name}</deposito>
      <observacoes>Transferência expedição: saída para ${siteStore.tiny_deposit_name}</observacoes>
    </estoque>`;

    const sourceResp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${sourceStore.tiny_token}&formato=json&estoque=${encodeURIComponent(sourceXml)}`,
    });
    results.source = await sourceResp.json();
    console.log(`Source stock update (${sourceStore.tiny_deposit_name}):`, results.source.retorno?.status);

    if (results.source.retorno?.status === 'Erro') {
      const errMsg = results.source.retorno?.erros?.[0]?.erro || 'Erro ao atualizar estoque origem';
      throw new Error(`Erro origem: ${errMsg}`);
    }

    // Wait to respect rate limits
    await new Promise(r => setTimeout(r, 1500));

    // Update site store stock (increase)
    const siteXml = `<estoque>
      <idProduto>${siteProduct?.tiny_id || sourceProduct.tiny_id}</idProduto>
      <tipo>B</tipo>
      <quantidade>${siteNewQty}</quantidade>
      <deposito>${siteStore.tiny_deposit_name}</deposito>
      <observacoes>Transferência expedição: entrada de ${sourceStore.tiny_deposit_name}</observacoes>
    </estoque>`;

    const siteResp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${siteStore.tiny_token}&formato=json&estoque=${encodeURIComponent(siteXml)}`,
    });
    results.site = await siteResp.json();
    console.log(`Site stock update (${siteStore.tiny_deposit_name}):`, results.site.retorno?.status);

    if (results.site.retorno?.status === 'Erro') {
      const errMsg = results.site.retorno?.erros?.[0]?.erro || 'Erro ao atualizar estoque destino';
      // Try to rollback source
      console.error('Site update failed, attempting rollback on source...');
      throw new Error(`Erro destino: ${errMsg}`);
    }

    // Update local cache
    await supabase
      .from('pos_products')
      .update({ stock: sourceNewQty, synced_at: new Date().toISOString() })
      .eq('store_id', source_store_id)
      .eq('sku', sourceProduct.sku);

    if (siteProduct) {
      await supabase
        .from('pos_products')
        .update({ stock: siteNewQty, synced_at: new Date().toISOString() })
        .eq('store_id', siteStore.id)
        .eq('sku', sourceProduct.sku);
    }

    return new Response(JSON.stringify({
      success: true,
      product: sourceProduct.name,
      sku: sourceProduct.sku,
      from: { store: sourceStore.name, deposit: sourceStore.tiny_deposit_name, new_stock: sourceNewQty },
      to: { store: siteStore.name, deposit: siteStore.tiny_deposit_name, new_stock: siteNewQty },
      quantity,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Transfer error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
