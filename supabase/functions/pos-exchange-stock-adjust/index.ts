import { withRequiredAuth } from "../_shared/withRequiredAuth.ts";
import { withAccessLog } from "../_shared/withAccessLog.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SITE_LIVE_STORE_ID = "2bd2c08d-321c-47ee-98a9-e27e936818ab";
const PEROLA_STORE_ID = "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2";

interface StockItem {
  sku?: string;
  barcode?: string;
  product_name: string;
  quantity: number;
  direction: "in" | "out";
}

// Ajuste de estoque de trocas 100% interno (pos_products). NÃO usa Tiny.
serve(withAccessLog("pos-exchange-stock-adjust", withRequiredAuth(["pos"], false, async (req) => {
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

    const mirrorItems: { barcode?: string; sku?: string }[] = [];
    for (const item of items) {
      try {
        if (!item.barcode && !item.sku) {
          results.push({ product_name: item.product_name, success: false, error: 'Item sem barcode/sku' });
          continue;
        }

        // Localiza o produto no estoque interno da loja (barcode preferencial, depois sku).
        // Site/Live fica sempre zero: o ajuste vai para a Loja Pérola (mesmo código).
        const targetStore = store_id === SITE_LIVE_STORE_ID ? PEROLA_STORE_ID : store_id;
        let query = supabase
          .from('pos_products')
          .select('id, stock, sku, barcode')
          .eq('store_id', targetStore);
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

        // Grava SOMENTE pela função segura (trava a linha + histórico antes do saldo).
        const { data: mv, error: mvErr } = await supabase.rpc('pos_stock_move', {
          p_product_id: row.id,
          p_direction: item.direction,
          p_quantity: item.quantity,
          p_reason: `Troca PDV – ${item.product_name}`,
          p_seller_id: null,
          p_seller_name: null,
          p_user_id: null,
          p_user_name: null,
        });

        if (mvErr) {
          results.push({ product_name: item.product_name, success: false, error: mvErr.message });
        } else {
          const currentStock = Number((mv as any)?.previous_stock ?? 0);
          const newStock = Number((mv as any)?.new_stock ?? 0);
          results.push({ product_name: item.product_name, success: true, currentStock, newStock });
          if (currentStock !== newStock && (row.barcode || row.sku)) {
            mirrorItems.push({ barcode: row.barcode || undefined, sku: row.sku || undefined });
          }
          console.log(`Troca [interno] ${item.product_name}: ${currentStock} -> ${newStock} (${item.direction})`);
        }
      } catch (e) {
        console.error(`Error adjusting stock for ${item.product_name}:`, e);
        results.push({ product_name: item.product_name, success: false, error: (e as Error).message });
      }
    }

    // Espelho Shopify (não há trigger em pos_products): uma vez por produto, em background.
    const seen = new Set<string>();
    for (const m of mirrorItems) {
      const k = `${m.barcode ?? ''}|${m.sku ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const p = supabase.functions
        .invoke('shopify-mirror-stock', { body: { sale_id: null, sale_event: 'manual_adjust', items: [m] } })
        .catch((e) => console.error('[pos-exchange-stock-adjust] mirror error', e));
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch (_) { /* ignore */ }
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
})));
