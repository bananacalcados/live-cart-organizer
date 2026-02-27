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
    const { store_id, tiny_id, quantity, direction, reason, product_name, sku, barcode, product_id, seller_id, seller_name } = await req.json();

    if (!store_id || !tiny_id || !quantity || !direction) {
      throw new Error('store_id, tiny_id, quantity, direction are required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get store config
    const { data: store, error: storeError } = await supabase
      .from('pos_stores')
      .select('tiny_token, tiny_deposit_name')
      .eq('id', store_id)
      .single();

    if (storeError || !store?.tiny_token) throw new Error('Store not found or token not configured');

    const token = store.tiny_token;
    const depositName = store.tiny_deposit_name || '';

    // 1. Get current stock from Tiny for the specific deposit
    const stockResp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&id=${tiny_id}`,
    });
    const stockText = await stockResp.text();
    console.log(`Stock response for ${product_name} (${tiny_id}):`, stockText.substring(0, 500));

    let stockData: any;
    try { stockData = JSON.parse(stockText); } catch {
      throw new Error('Failed to parse stock response from Tiny');
    }

    // Parse stock for specific deposit
    let currentStock = 0;
    if (depositName) {
      const depositos = stockData.retorno?.produto?.depositos || [];
      for (const dep of depositos) {
        const d = dep.deposito || dep;
        if (d.nome === depositName) {
          currentStock = parseFloat(d.saldo || '0');
          break;
        }
      }
      console.log(`Deposit "${depositName}" current stock: ${currentStock}`);
    } else {
      currentStock = parseFloat(stockData.retorno?.produto?.saldo || '0');
      console.log(`Global current stock: ${currentStock}`);
    }

    // 2. Calculate new absolute stock
    const qty = parseFloat(quantity);
    const newStock = direction === 'in'
      ? currentStock + qty
      : Math.max(0, currentStock - qty);

    console.log(`Calculating: ${currentStock} ${direction === 'in' ? '+' : '-'} ${qty} = ${newStock}`);

    // 3. Send balance update (tipo B) to Tiny
    const obsText = direction === 'in'
      ? `Balanco POS: entrada +${qty}${reason ? '. ' + reason : ''}`
      : `Balanco POS: saida -${qty}${reason ? '. ' + reason : ''}`;

    const estoquePayload: any = {
      idProduto: Number(tiny_id),
      tipo: 'B',
      quantidade: String(newStock),
      observacoes: obsText,
    };
    if (depositName) {
      estoquePayload.nome_deposito = depositName;
    }
    const estoqueJson = JSON.stringify({ estoque: estoquePayload });
    console.log(`Sending stock update JSON:`, estoqueJson);

    const formBody = new URLSearchParams();
    formBody.set('token', token);
    formBody.set('formato', 'json');
    formBody.set('estoque', estoqueJson);

    const updateResp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
    });
    const updateText = await updateResp.text();
    console.log(`Update response:`, updateText.substring(0, 500));

    let updateData: any;
    try { updateData = JSON.parse(updateText); } catch {
      throw new Error('Failed to parse update response: ' + updateText.substring(0, 100));
    }

    if (updateData.retorno?.status === 'Erro') {
      const nestedError = updateData.retorno?.registros?.registro?.erros?.[0]?.erro;
      const topError = updateData.retorno?.erros?.[0]?.erro;
      const errorMsg = nestedError || topError || JSON.stringify(updateData.retorno) || 'Unknown error';
      throw new Error(errorMsg);
    }

    console.log(`Stock adjusted [${depositName || 'global'}]: ${product_name} (${tiny_id}) ${currentStock} -> ${newStock} (${direction})`);

    // 4. Update local cache (pos_products)
    if (product_id) {
      await supabase
        .from('pos_products')
        .update({ stock: newStock })
        .eq('id', product_id);
    } else {
      await supabase
        .from('pos_products')
        .update({ stock: newStock })
        .eq('tiny_id', tiny_id)
        .eq('store_id', store_id);
    }

    // 5. Save adjustment record
    await supabase.from('pos_stock_adjustments').insert({
      store_id,
      product_id: product_id || null,
      tiny_id,
      sku: sku || null,
      barcode: barcode || null,
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
