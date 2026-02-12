import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface StockItem {
  tiny_id: number;
  product_name: string;
  quantity: number;
  direction: "in" | "out"; // in = returned to store, out = given to customer
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, items } = await req.json() as { store_id: string; items: StockItem[] };

    if (!store_id) throw new Error('store_id is required');
    if (!items?.length) throw new Error('items array is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get store token
    const { data: store, error: storeError } = await supabase
      .from('pos_stores')
      .select('tiny_token')
      .eq('id', store_id)
      .single();

    if (storeError || !store?.tiny_token) throw new Error('Store not found or token not configured');

    const token = store.tiny_token;
    const results: { product_name: string; success: boolean; error?: string }[] = [];

    for (const item of items) {
      try {
        // Get current stock from Tiny
        const stockResp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&id=${item.tiny_id}`,
        });
        const stockData = await stockResp.json();
        const currentStock = parseFloat(stockData.retorno?.produto?.saldo || '0');

        // Calculate new stock
        const newStock = item.direction === 'in'
          ? currentStock + item.quantity
          : currentStock - item.quantity;

        // Update stock in Tiny
        const updateResp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&id=${item.tiny_id}&estoque=${Math.max(0, newStock)}`,
        });
        const updateData = await updateResp.json();

        if (updateData.retorno?.status === 'Erro') {
          const errorMsg = updateData.retorno?.erros?.[0]?.erro || 'Unknown error';
          results.push({ product_name: item.product_name, success: false, error: errorMsg });
        } else {
          results.push({ product_name: item.product_name, success: true });
          console.log(`Stock adjusted: ${item.product_name} (${item.tiny_id}) ${item.direction === 'in' ? '+' : '-'}${item.quantity} → ${newStock}`);
        }

        // Rate limit: wait 2s between Tiny API calls
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.error(`Error adjusting stock for ${item.product_name}:`, e);
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
