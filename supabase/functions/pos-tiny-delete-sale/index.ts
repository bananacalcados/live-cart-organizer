import { withRequiredAuth } from "../_shared/withRequiredAuth.ts";
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(withAccessLog("pos-tiny-delete-sale", withRequiredAuth(["pos"], false, async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, sale_id, cancel_tiny_only } = await req.json();

    // Compatibilidade com chamadas antigas: não há mais operação externa a cancelar.
    if (cancel_tiny_only) {
      return new Response(JSON.stringify({ success: true, messages: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!store_id || !sale_id) throw new Error('store_id and sale_id are required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get sale details
    const { data: sale } = await supabase
      .from('pos_sales')
      .select('*')
      .eq('id', sale_id)
      .single();

    if (!sale) throw new Error('Sale not found');

    const results: string[] = [];

    // 1. Restore stock in pos_products (single return: deleting the sale skips its cancel trigger)
    const { data: saleItems } = await supabase
      .from('pos_sale_items')
      .select('sku, quantity, product_name')
      .eq('sale_id', sale_id);

    if (saleItems && saleItems.length > 0) {
      for (const item of saleItems) {
        if (item.sku) {
          const { data: product } = await supabase
            .from('pos_products')
            .select('id, stock, name, sku, barcode, tiny_id')
            .eq('store_id', store_id)
            .eq('sku', item.sku)
            .maybeSingle();

          if (product) {
            const previousStock = Number(product.stock || 0);
            const newStock = previousStock + Number(item.quantity || 0);

            // Classify the return before changing stock, avoiding "Ajuste direto sem classificação".
            const { error: adjustmentError } = await supabase
              .from('pos_stock_adjustments')
              .insert({
                store_id,
                product_id: product.id,
                tiny_id: product.tiny_id ?? null,
                sku: product.sku ?? item.sku,
                barcode: product.barcode ?? null,
                product_name: product.name || item.product_name || 'Produto',
                direction: 'in',
                quantity: item.quantity,
                previous_stock: previousStock,
                new_stock: newStock,
                reason: 'Venda excluída no PDV',
                movement_type: 'devolucao',
                sale_id: null,
              });
            if (adjustmentError) throw adjustmentError;

            const { error: stockError } = await supabase
              .from('pos_products')
              .update({ stock: newStock, synced_at: new Date().toISOString() })
              .eq('id', product.id);
            if (stockError) throw stockError;
          }
        }
      }
      results.push('Estoque local restaurado');
    }

    // 2. Reverse gamification points
    if (sale.seller_id) {
      const { data: gamification } = await supabase
        .from('pos_gamification')
        .select('id, total_points, sales_count')
        .eq('seller_id', sale.seller_id)
        .eq('store_id', store_id)
        .maybeSingle();

      if (gamification) {
        const pointsToRemove = 10; // same as awarded on sale
        await supabase.from('pos_gamification').update({
          total_points: Math.max(0, gamification.total_points - pointsToRemove),
          sales_count: Math.max(0, gamification.sales_count - 1),
        }).eq('id', gamification.id);
        results.push('Pontuação de gamificação revertida');
      }
    }

    // 3. Delete sale items and sale from local DB
    await supabase.from('pos_sale_items').delete().eq('sale_id', sale_id);
    await supabase.from('pos_sales').delete().eq('id', sale_id);
    results.push('Venda excluída do sistema');

    return new Response(JSON.stringify({
      success: true,
      messages: results,
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
})));
