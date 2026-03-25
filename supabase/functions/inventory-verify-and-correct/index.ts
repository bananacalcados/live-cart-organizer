import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const VERIFY_DELAY_MS = 1500;
const DEFAULT_BATCH_SIZE = 8;
const MAX_SAFE_BATCH_SIZE = 8;

function queueNextBatch(
  supabaseUrl: string,
  authKey: string,
  payload: { count_id: string; store_id: string; batch_size: number; also_correct: boolean },
) {
  const nextRun = fetch(`${supabaseUrl}/functions/v1/inventory-verify-and-correct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authKey}`,
    },
    body: JSON.stringify(payload),
  }).catch(e => console.error('Self-invoke failed:', e));

  const edgeRuntime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;

  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(nextRun);
  }
}

/**
 * Server-side batch verification of Tiny stock.
 * Self-invokes until all items are verified — no browser needed.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { count_id, store_id, batch_size = DEFAULT_BATCH_SIZE, also_correct = false } = await req.json();
    if (!count_id || !store_id) throw new Error('count_id and store_id are required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const functionAuthKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || serviceRoleKey;
    const safeBatchSize = Math.max(1, Math.min(Number(batch_size) || DEFAULT_BATCH_SIZE, MAX_SAFE_BATCH_SIZE));

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get store config
    const { data: store } = await supabase
      .from('pos_stores')
      .select('tiny_token, tiny_deposit_name')
      .eq('id', store_id)
      .single();

    if (!store?.tiny_token) throw new Error('Store token not found');

    const token = store.tiny_token;
    const depositName = store.tiny_deposit_name || null;

    // Get items that still need stock verification (current_stock IS NULL)
    const { data: items, error: fetchErr } = await supabase
      .from('inventory_count_items')
      .select('id, product_id, counted_quantity')
      .eq('count_id', count_id)
      .is('current_stock', null)
      .order('created_at', { ascending: true })
      .limit(safeBatchSize);

    if (fetchErr) throw fetchErr;

    // Count total remaining
    const { count: remainingCount } = await supabase
      .from('inventory_count_items')
      .select('id', { count: 'exact', head: true })
      .eq('count_id', count_id)
      .is('current_stock', null);

    const totalRemaining = (remainingCount || 0);

    if (!items || items.length === 0) {
      // All items verified — calculate final stats
      const { data: allItems } = await supabase
        .from('inventory_count_items')
        .select('id, product_id, product_name, counted_quantity, current_stock, divergence')
        .eq('count_id', count_id)
        .range(0, 10000);

      const divergent = allItems?.filter(i => i.divergence !== null && i.divergence !== 0) || [];

      await supabase.from('inventory_counts').update({
        status: 'reviewing',
        total_products: allItems?.length || 0,
        divergent_products: divergent.length,
      }).eq('id', count_id);

      // If also_correct, enqueue all divergent items
      if (also_correct && divergent.length > 0) {
        const { count: existingQueue } = await supabase
          .from('inventory_correction_queue')
          .select('id', { count: 'exact', head: true })
          .eq('count_id', count_id);

        if (!existingQueue || existingQueue === 0) {
          const toCorrect = divergent.filter(i =>
            (i.divergence !== null && i.divergence !== 0) ||
            (i.counted_quantity === 0 && i.current_stock && i.current_stock > 0)
          );

          for (const item of toCorrect) {
            await supabase.from('inventory_correction_queue').insert({
              count_id,
              count_item_id: item.id,
              store_id,
              product_id: item.product_id,
              product_name: item.product_name,
              new_quantity: item.counted_quantity,
              old_quantity: item.current_stock,
            });
          }

          await supabase.from('inventory_counts').update({ status: 'correcting' }).eq('id', count_id);
          console.log(`[inventory-verify-and-correct] Enqueued ${toCorrect.length} items for correction`);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        verified: 0,
        remaining: 0,
        done: true,
        divergent_count: divergent.length,
        total: allItems?.length || 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process batch — verify each item's stock in Tiny
    let verified = 0;
    let errors = 0;

    for (const item of items) {
      try {
        const resp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&id=${item.product_id}`,
        });

        const data = await resp.json();

        if (data.retorno?.status === 'Erro') {
          const errMsg = data.retorno?.erros?.[0]?.erro || 'Unknown';
          console.warn(`[verify] product ${item.product_id}: Tiny error: ${errMsg}, setting stock=0`);
          const divergence = item.counted_quantity - 0;
          await supabase.from('inventory_count_items').update({
            current_stock: 0,
            divergence,
          }).eq('id', item.id);
          verified++;
        } else {
          const produto = data.retorno?.produto;
          const depositos = produto?.depositos || [];
          let stock = parseFloat(produto?.saldo || '0');

          if (depositName && depositos.length > 0) {
            const matched = depositos.find((d: any) => {
              const dep = d?.deposito || d;
              const name = dep?.nome || dep?.descricao || '';
              return name.toLowerCase() === depositName.toLowerCase();
            });
            if (matched) {
              const dep = matched?.deposito || matched;
              stock = parseFloat(dep?.saldo || '0');
            }
          } else if (depositos.length === 1) {
            const dep = depositos[0]?.deposito || depositos[0];
            stock = parseFloat(dep?.saldo || produto?.saldo || '0');
          }

          const divergence = item.counted_quantity - stock;
          await supabase.from('inventory_count_items').update({
            current_stock: stock,
            divergence,
          }).eq('id', item.id);
          verified++;
        }
      } catch (e) {
        console.error(`[verify] Error for product ${item.product_id}:`, e);
        await supabase.from('inventory_count_items').update({
          current_stock: -999,
          divergence: null,
        }).eq('id', item.id);
        errors++;
      }

      // Throttle: ~1.5s between calls
      await new Promise(r => setTimeout(r, VERIFY_DELAY_MS));
    }

    const newRemaining = totalRemaining - items.length;
    console.log(`[inventory-verify-and-correct] Verified ${verified}, errors ${errors}, remaining ~${newRemaining}`);

    const isDone = newRemaining <= 0;

    // Self-invoke if there are more items to process
    if (!isDone) {
      try {
        queueNextBatch(supabaseUrl, functionAuthKey, {
          count_id,
          store_id,
          batch_size: safeBatchSize,
          also_correct,
        });
        console.log(`Self-invoked for count_id=${count_id}, remaining ~${newRemaining}, batch_size=${safeBatchSize}`);
      } catch (e) {
        console.error('Self-invoke error:', e);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      verified,
      errors,
      remaining: Math.max(0, newRemaining),
      done: isDone,
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
