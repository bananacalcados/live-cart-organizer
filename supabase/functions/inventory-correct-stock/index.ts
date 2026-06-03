import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function queueNextBatch(
  supabaseUrl: string,
  authKey: string,
  payload: { count_id: string; batch_size: number; final: boolean },
) {
  const nextRun = fetch(`${supabaseUrl}/functions/v1/inventory-correct-stock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authKey}`,
    },
    body: JSON.stringify(payload),
  }).then(async (r) => {
    await r.text(); // consume body
  }).catch(e => console.error('Self-invoke failed:', e));

  const edgeRuntime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;

  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(nextRun);
  }
}

/**
 * Aplica a correção do balanço de estoque 100% LOCAL.
 * Fonte da verdade: pos_products. NÃO grava no Tiny.
 * Processa a fila inventory_correction_queue gravando o saldo contado direto
 * no pos_products. Auto-reinvoca até concluir.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { count_id, batch_size = 100 } = await req.json();
    if (!count_id) throw new Error('count_id is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || serviceRoleKey;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Heartbeat: record that this batch is running ──
    await supabase.from('inventory_counts').update({
      last_batch_at: new Date().toISOString(),
    }).eq('id', count_id);

    // Get pending items
    const { data: items, error: fetchError } = await supabase
      .from('inventory_correction_queue')
      .select('*')
      .eq('count_id', count_id)
      .in('status', ['pending', 'error'])
      .lt('attempts', 5)
      .order('created_at', { ascending: true })
      .limit(batch_size);

    if (fetchError) throw fetchError;
    if (!items || items.length === 0) {
      // All done — update count status to completed
      await supabase.from('inventory_counts').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        last_batch_at: new Date().toISOString(),
      }).eq('id', count_id);

      return new Response(JSON.stringify({ success: true, processed: 0, remaining: 0, done: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    let errors = 0;

    for (const item of items) {
      // Mark as processing
      await supabase.from('inventory_correction_queue').update({
        status: 'processing', attempts: item.attempts + 1
      }).eq('id', item.id);

      try {
        const nowIso = new Date().toISOString();
        const newQty = item.new_quantity;
        let updatedId: string | null = null;

        // 1) Tenta casar pelo tiny_id (product_id da fila é o id do Tiny) + loja
        const tinyIdNum = Number(item.product_id);
        if (!Number.isNaN(tinyIdNum)) {
          const { data: updRows } = await supabase
            .from('pos_products')
            .update({ stock: newQty, synced_at: nowIso })
            .eq('tiny_id', tinyIdNum)
            .eq('store_id', item.store_id)
            .select('id');
          if (updRows && updRows.length > 0) updatedId = updRows[0].id;
        }

        // 2) Fallback: casa por sku/barcode do item de contagem + loja
        if (!updatedId) {
          const { data: ci } = await supabase
            .from('inventory_count_items')
            .select('sku, barcode')
            .eq('id', item.count_item_id)
            .maybeSingle();
          const ident = ci?.sku || ci?.barcode;
          if (ident) {
            const { data: updRows2 } = await supabase
              .from('pos_products')
              .update({ stock: newQty, synced_at: nowIso })
              .eq('store_id', item.store_id)
              .or(`sku.eq.${ident},barcode.eq.${ident}`)
              .select('id');
            if (updRows2 && updRows2.length > 0) updatedId = updRows2[0].id;
          }
        }

        if (!updatedId) {
          const errMsg = 'Produto não encontrado no estoque local (pos_products)';
          await supabase.from('inventory_correction_queue').update({
            status: 'error', error_message: errMsg
          }).eq('id', item.id);
          await supabase.from('inventory_count_items').update({
            correction_status: 'error', correction_error: errMsg
          }).eq('id', item.count_item_id);
          errors++;
          continue;
        }

        // Registra histórico do ajuste (balanço absoluto)
        await supabase.from('pos_stock_adjustments').insert({
          store_id: item.store_id,
          product_id: updatedId,
          tiny_id: Number.isNaN(tinyIdNum) ? null : tinyIdNum,
          product_name: item.product_name || 'Unknown',
          direction: 'balance',
          quantity: newQty,
          previous_stock: item.old_quantity ?? null,
          new_stock: newQty,
          reason: 'Balanço de estoque - correção automática (local)',
        });

        await supabase.from('inventory_correction_queue').update({
          status: 'completed', processed_at: nowIso
        }).eq('id', item.id);
        await supabase.from('inventory_count_items').update({
          correction_status: 'corrected', corrected_at: nowIso
        }).eq('id', item.count_item_id);
        console.log(`[inventory-correct-stock][LOCAL] product ${item.product_id} @ store ${item.store_id} -> stock=${newQty}`);
        processed++;
      } catch (e) {
        console.error(`Error correcting product ${item.product_id}:`, e);
        await supabase.from('inventory_correction_queue').update({
          status: 'error', error_message: e.message
        }).eq('id', item.id);
        await supabase.from('inventory_count_items').update({
          correction_status: 'error', correction_error: e.message
        }).eq('id', item.count_item_id);
        errors++;
      }
    }

    // Update count stats using aggregate queries to avoid 1000-row limit
    const { count: completedCount } = await supabase
      .from('inventory_correction_queue')
      .select('*', { count: 'exact', head: true })
      .eq('count_id', count_id)
      .eq('status', 'completed');

    const { count: errorCount } = await supabase
      .from('inventory_correction_queue')
      .select('*', { count: 'exact', head: true })
      .eq('count_id', count_id)
      .eq('status', 'error')
      .gte('attempts', 5);

    const { count: remainingCount } = await supabase
      .from('inventory_correction_queue')
      .select('*', { count: 'exact', head: true })
      .eq('count_id', count_id)
      .in('status', ['pending', 'processing', 'error'])
      .lt('attempts', 5);

    const remaining = remainingCount || 0;

    await supabase.from('inventory_counts').update({
      corrected_products: completedCount || 0,
      correction_errors: errorCount || 0,
      last_batch_at: new Date().toISOString(),
    }).eq('id', count_id);

    const isDone = remaining <= 0;

    // Self-invoke if there are more items to process (with waitUntil!)
    if (!isDone) {
      try {
        queueNextBatch(supabaseUrl, anonKey, { count_id, batch_size });
        console.log(`Self-invoked for count_id=${count_id}, remaining ~${remaining - processed}`);
      } catch (e) {
        console.error('Self-invoke error:', e);
      }
    }

    return new Response(JSON.stringify({
      success: true, processed, errors,
      remaining,
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
