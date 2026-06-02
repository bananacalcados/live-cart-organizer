import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Balanço de estoque 100% LOCAL.
 * Fonte da verdade: tabela pos_products. NÃO lê nem grava no Tiny.
 * Calcula o novo saldo a partir do estoque local, atualiza pos_products e
 * registra o histórico em pos_stock_adjustments.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, tiny_id, quantity, direction, reason, product_name, sku, barcode, product_id, seller_id, seller_name } = await req.json();

    if (!quantity || !direction) {
      throw new Error('quantity e direction são obrigatórios');
    }
    if (!product_id && !(store_id && (tiny_id || sku || barcode))) {
      throw new Error('Informe product_id, ou store_id + (tiny_id/sku/barcode)');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Localiza a linha do produto no estoque LOCAL (pos_products)
    let row: any = null;

    if (product_id) {
      const { data } = await supabase
        .from('pos_products')
        .select('id, stock, store_id, tiny_id, sku, barcode')
        .eq('id', product_id)
        .maybeSingle();
      row = data;
    }

    if (!row && store_id) {
      let q = supabase
        .from('pos_products')
        .select('id, stock, store_id, tiny_id, sku, barcode')
        .eq('store_id', store_id);
      if (tiny_id) q = q.eq('tiny_id', tiny_id);
      else if (sku) q = q.eq('sku', sku);
      else if (barcode) q = q.eq('barcode', barcode);
      const { data } = await q.limit(1).maybeSingle();
      row = data;
    }

    if (!row) {
      throw new Error('Produto não encontrado no estoque local (pos_products)');
    }

    // 2. Calcula novo saldo absoluto a partir do estoque local
    const currentStock = Number(row.stock || 0);
    const qty = parseFloat(quantity);
    const newStock = direction === 'in'
      ? currentStock + qty
      : Math.max(0, currentStock - qty);

    console.log(`[pos-stock-balance][LOCAL] ${product_name || row.sku} (loja ${row.store_id}): ${currentStock} ${direction === 'in' ? '+' : '-'} ${qty} = ${newStock}`);

    // 3. Atualiza o estoque local
    const { error: updErr } = await supabase
      .from('pos_products')
      .update({ stock: newStock, synced_at: new Date().toISOString() })
      .eq('id', row.id);
    if (updErr) throw new Error('Falha ao atualizar pos_products: ' + updErr.message);

    // 4. Registra o histórico do ajuste
    await supabase.from('pos_stock_adjustments').insert({
      store_id: row.store_id,
      product_id: row.id,
      tiny_id: row.tiny_id ?? tiny_id ?? null,
      sku: sku || row.sku || null,
      barcode: barcode || row.barcode || null,
      product_name: product_name || 'Unknown',
      direction,
      quantity: qty,
      previous_stock: currentStock,
      new_stock: newStock,
      reason: reason || null,
      seller_id: seller_id || null,
      seller_name: seller_name || null,
    });

    return new Response(JSON.stringify({
      success: true,
      previous_stock: currentStock,
      new_stock: newStock,
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
