import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface StockItem {
  sku?: string;
  barcode?: string;
  product_name: string;
  quantity: number;
  direction: "in" | "out";
}

// Ajuste de estoque de trocas 100% interno (pos_products). NÃO usa Tiny.
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

    const results: { product_name: string; success: boolean; error?: string; currentStock?: number; newStock?: number }[] = [];

    for (const item of items) {
      try {
        if (!item.barcode && !item.sku) {
          results.push({ product_name: item.product_name, success: false, error: 'Item sem barcode/sku' });
          continue;
        }

        // Localiza o produto no estoque interno da loja (barcode preferencial, depois sku)
        let query = supabase
          .from('pos_products')
          .select('id, stock')
          .eq('store_id', store_id);
        if (item.barcode) query = query.eq('barcode', item.barcode);
        else query = query.eq('sku', item.sku!);

        const { data: rows, error: findErr } = await query.order('stock', { ascending: false }).limit(1);
        if (findErr) {
          results.push({ product_name: item.product_name, success: false, error: findErr.message });
          continue;
        }
        const row = rows?.[0];
        if (!row) {
          results.push({ product_name: item.product_name, success: false, error: 'Produto não encontrado no estoque interno' });
          continue;
        }

        const currentStock = Number(row.stock || 0);
        const newStock = item.direction === 'in'
          ? currentStock + item.quantity
          : Math.max(0, currentStock - item.quantity);

        const { error: updErr } = await supabase
          .from('pos_products')
          .update({ stock: newStock, updated_at: new Date().toISOString() })
          .eq('id', row.id);

        if (updErr) {
          results.push({ product_name: item.product_name, success: false, error: updErr.message, currentStock, newStock });
        } else {
          results.push({ product_name: item.product_name, success: true, currentStock, newStock });
          console.log(`Troca [interno] ${item.product_name}: ${currentStock} -> ${newStock} (${item.direction})`);
        }
      } catch (e) {
        console.error(`Error adjusting stock for ${item.product_name}:`, e);
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
