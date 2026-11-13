import { withAccessLog } from "../_shared/withAccessLog.ts";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";
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
serve(withAccessLog("pos-stock-balance", async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
// Fase 4 auth: funcionário com módulo ou chamada interna (service_role + x-internal-call).
{ const denied = await requireStaffOrInternal(req, ["inventory","pos"], false); if (denied) return denied; }

  try {
    const { store_id, tiny_id, quantity, direction, reason, product_name, sku, barcode, product_id, seller_id, seller_name, target_stock } = await req.json();

    const hasTarget = target_stock !== undefined && target_stock !== null && target_stock !== '';
    const target = hasTarget ? Number(target_stock) : NaN;
    if (hasTarget && (!Number.isFinite(target) || target < 0)) {
      throw new Error('target_stock inválido');
    }
    if (!hasTarget && (!quantity || (direction !== 'in' && direction !== 'out'))) {
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

    // 2. Ajuste atômico no banco (trava a linha, calcula, grava histórico e saldo)
    const common = {
      p_product_id: row.id,
      p_reason: reason || null,
      p_seller_id: seller_id || null,
      p_seller_name: seller_name || null,
      p_user_id: null,
      p_user_name: null,
    };
    const { data: rpc, error: rpcErr } = hasTarget
      ? await supabase.rpc('pos_stock_balance_to', { ...common, p_target: target })
      : await supabase.rpc('pos_stock_move', { ...common, p_direction: direction, p_quantity: parseFloat(quantity) });
    if (rpcErr) throw new Error('Falha ao ajustar estoque: ' + rpcErr.message);
    const res: any = rpc || {};
    if (res.success === false) throw new Error(res.error || 'Falha ao ajustar estoque');
    const currentStock = Number(res.previous_stock ?? 0);
    const newStock = Number(res.new_stock ?? 0);
    console.log(`[pos-stock-balance][LOCAL] ${product_name || row.sku} (loja ${row.store_id}): ${currentStock} -> ${newStock}`);

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
}));
