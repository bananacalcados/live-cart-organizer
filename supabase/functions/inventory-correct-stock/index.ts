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
 * Balanço Total Inteligente: monta linhas de fila para ZERAR as variações
 * (irmãs) que NÃO foram bipadas dentro de um produto-pai que teve pelo menos
 * uma variação bipada. Regra: bipou => tem estoque; não bipou => esgotou => 0.
 *
 * Segurança:
 *  - Escopo estrito na loja da contagem (storeId).
 *  - Nunca zera um código que foi bipado (sku/barcode presente no conjunto).
 *  - Idempotente: só considera irmãos com estoque != 0 e pula os já zerados
 *    (last_corrected_quantity === 0). Re-bipar restaura no ciclo seguinte.
 *  - Cria um inventory_count_items (counted=0) para o irmão zerado, para
 *    aparecer no relatório e permitir o re-bip por dedup de produto.
 */
async function buildSiblingZeroRows(
  supabase: any,
  count_id: string,
  storeId: string,
  scanned: Array<{ sku?: string | null; barcode?: string | null }>,
): Promise<Array<Record<string, unknown>>> {
  const IN_CHUNK = 150;

  // 1) Conjunto de códigos bipados (sku + barcode) de TODA a contagem.
  const scannedSkus = new Set<string>();
  const scannedBarcodes = new Set<string>();
  for (const s of scanned) {
    if (s.sku) scannedSkus.add(String(s.sku).trim());
    if (s.barcode) scannedBarcodes.add(String(s.barcode).trim());
  }
  const scannedIdents = [...new Set([...scannedSkus, ...scannedBarcodes])].filter(Boolean);
  if (scannedIdents.length === 0) return [];

  // 2) Produtos-pai (parent_sku) tocados a partir dos códigos bipados.
  const parentSet = new Set<string>();
  for (let i = 0; i < scannedIdents.length; i += IN_CHUNK) {
    const chunk = scannedIdents.slice(i, i + IN_CHUNK);
    const list = chunk.map((c) => `"${c.replace(/"/g, '')}"`).join(',');
    const { data: prows } = await supabase
      .from('pos_products')
      .select('parent_sku')
      .eq('store_id', storeId)
      .not('parent_sku', 'is', null)
      .or(`sku.in.(${list}),barcode.in.(${list})`);
    for (const p of (prows || [])) {
      if (p.parent_sku) parentSet.add(p.parent_sku);
    }
  }
  const parents = [...parentSet];
  if (parents.length === 0) return [];

  // 3) Todas as variações desses pais na loja COM estoque != 0.
  let siblings: any[] = [];
  for (let i = 0; i < parents.length; i += IN_CHUNK) {
    const chunk = parents.slice(i, i + IN_CHUNK);
    let pfrom = 0;
    while (true) {
      const { data: page } = await supabase
        .from('pos_products')
        .select('tiny_id, sku, barcode, name, variant, stock')
        .eq('store_id', storeId)
        .in('parent_sku', chunk)
        .neq('stock', 0)
        .range(pfrom, pfrom + 999);
      if (!page || page.length === 0) break;
      siblings = siblings.concat(page);
      if (page.length < 1000) break;
      pfrom += 1000;
    }
  }
  if (siblings.length === 0) return [];

  // 4) Mantém só os NÃO bipados, dedup por código (sku|barcode).
  const seen = new Set<string>();
  const toZero: any[] = [];
  for (const v of siblings) {
    const vsku = v.sku ? String(v.sku).trim() : '';
    const vbc = v.barcode ? String(v.barcode).trim() : '';
    if (vsku && scannedSkus.has(vsku)) continue;
    if (vbc && scannedBarcodes.has(vbc)) continue;
    const key = vsku + '|' + vbc;
    if (seen.has(key)) continue;
    seen.add(key);
    toZero.push(v);
  }
  if (toZero.length === 0) return [];

  // 5) count_items já existentes nesta contagem (indexados por código).
  const existingByKey = new Map<string, any>();
  {
    let efrom = 0;
    while (true) {
      const { data: page } = await supabase
        .from('inventory_count_items')
        .select('id, sku, barcode, counted_quantity, last_corrected_quantity')
        .eq('count_id', count_id)
        .range(efrom, efrom + 999);
      if (!page || page.length === 0) break;
      for (const it of page) {
        const k = (it.sku ? String(it.sku).trim() : '') + '|' + (it.barcode ? String(it.barcode).trim() : '');
        existingByKey.set(k, it);
      }
      if (page.length < 1000) break;
      efrom += 1000;
    }
  }

  const rows: Array<Record<string, unknown>> = [];
  const newCountItems: any[] = [];

  for (const v of toZero) {
    const vsku = v.sku ? String(v.sku).trim() : '';
    const vbc = v.barcode ? String(v.barcode).trim() : '';
    const key = vsku + '|' + vbc;
    const stock = Number(v.stock) || 0;
    const productId = v.tiny_id != null ? String(v.tiny_id) : (vsku || vbc || 'unknown');
    const productName = (v.name || 'Unknown') + (v.variant ? ` - ${v.variant}` : '');
    const ex = existingByKey.get(key);

    if (ex) {
      // Já bipado nesta contagem -> NUNCA zerar.
      if ((ex.counted_quantity ?? 0) > 0) continue;
      // Já zerado e corrigido antes -> idempotente, pula.
      if (ex.last_corrected_quantity === 0) continue;
      rows.push({
        count_id,
        count_item_id: ex.id,
        store_id: storeId,
        product_id: productId,
        product_name: productName,
        new_quantity: 0,
        old_quantity: stock,
      });
    } else {
      newCountItems.push({
        count_id,
        product_id: productId,
        product_name: productName,
        sku: v.sku || null,
        barcode: v.barcode || null,
        counted_quantity: 0,
        current_stock: stock,
        divergence: -stock,
      });
    }
  }

  // 6) Insere novos count_items zerados e captura ids para a fila.
  const CHUNK = 200;
  for (let i = 0; i < newCountItems.length; i += CHUNK) {
    const chunk = newCountItems.slice(i, i + CHUNK);
    const { data: inserted, error } = await supabase
      .from('inventory_count_items')
      .insert(chunk)
      .select('id, product_id, product_name, current_stock');
    if (error) throw error;
    for (const it of (inserted || [])) {
      rows.push({
        count_id,
        count_item_id: it.id,
        store_id: storeId,
        product_id: it.product_id != null ? String(it.product_id) : 'unknown',
        product_name: it.product_name || 'Unknown',
        new_quantity: 0,
        old_quantity: it.current_stock ?? 0,
      });
    }
  }

  return rows;
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
    const { count_id, batch_size = 100, final = true, prepare = false } = await req.json();
    if (!count_id) throw new Error('count_id is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || serviceRoleKey;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Heartbeat: record that this processing batch is running ──
    // Important: do NOT refresh the heartbeat before PREPARE's concurrency
    // guard reads it. Otherwise a stale smart_correcting run would look fresh
    // forever and the queue could never be rebuilt/resumed correctly.
    if (!prepare) {
      await supabase.from('inventory_counts').update({
        last_batch_at: new Date().toISOString(),
      }).eq('id', count_id);
    }

    // ── PREPARE mode (Total Inteligente "Salvar e corrigir bipados") ──
    // Builds the correction queue SERVER-SIDE from the scanned items, so the
    // client only makes ONE call (resilient on flaky store connections instead
    // of chaining delete+insert+update from the browser, which was aborting and
    // surfacing as "erro ao corrigir bipados: failed to fetch").
    if (prepare) {
      // Authoritative store comes from the count itself -> guarantees the
      // correction hits the SAME store the balance was started for (ex.: Centro).
      const { data: countRow, error: countErr } = await supabase
        .from('inventory_counts')
        .select('store_id, status, last_batch_at, scope')
        .eq('id', count_id)
        .maybeSingle();
      if (countErr) throw countErr;
      if (!countRow?.store_id) throw new Error('Contagem sem loja definida (store_id)');
      const storeId = countRow.store_id as string;
      const isSmartScope = countRow.scope === 'total_smart';

      // ── Concurrency guard ──
      // If a correction run is already active with a RECENT heartbeat (<2min),
      // do NOT delete/rebuild the queue mid-flight (that could drop rows a
      // running batch is processing). Just re-kick processing and return.
      const activeStatuses = ['correcting', 'smart_correcting'];
      const lastBatchMs = countRow.last_batch_at ? new Date(countRow.last_batch_at).getTime() : 0;
      const heartbeatFresh = Date.now() - lastBatchMs < 2 * 60 * 1000;
      if (activeStatuses.includes(countRow.status) && heartbeatFresh) {
        queueNextBatch(supabaseUrl, anonKey, { count_id, batch_size, final });
        return new Response(JSON.stringify({ success: true, prepared: 0, alreadyRunning: true, done: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Load scanned items (paginate to bypass the 1000-row cap)
      let scanned: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data: page, error: itErr } = await supabase
          .from('inventory_count_items')
          .select('id, product_id, product_name, sku, barcode, counted_quantity, current_stock, last_corrected_quantity')
          .eq('count_id', count_id)
          .gt('counted_quantity', 0)
          .order('created_at', { ascending: true })
          .range(from, from + pageSize - 1);
        if (itErr) throw itErr;
        if (!page || page.length === 0) break;
        scanned = scanned.concat(page);
        if (page.length < pageSize) break;
        from += pageSize;
      }

      // Only items whose counted qty changed since the last correction.
      const toCorrect = scanned.filter((i) =>
        i.last_corrected_quantity === null ||
        i.last_corrected_quantity === undefined ||
        i.last_corrected_quantity !== i.counted_quantity
      );

      // Clear any leftover queue for this count, then enqueue fresh rows.
      await supabase.from('inventory_correction_queue').delete().eq('count_id', count_id);

      // ── Zerar irmãos (variações NÃO bipadas do mesmo produto-pai) ──
      // Só no Balanço Total Inteligente. Ver .lovable/plan.md.
      let siblingZeroRows: Array<Record<string, unknown>> = [];
      if (isSmartScope && scanned.length > 0) {
        try {
          siblingZeroRows = await buildSiblingZeroRows(supabase, count_id, storeId, scanned);
        } catch (e) {
          // Falha ao montar irmãos NÃO deve derrubar a correção dos bipados.
          console.error('[prepare] buildSiblingZeroRows error:', e);
          siblingZeroRows = [];
        }
      }

      if (toCorrect.length === 0 && siblingZeroRows.length === 0) {
        await supabase.from('inventory_counts').update({
          status: final ? 'completed' : 'counting',
          last_batch_at: new Date().toISOString(),
          ...(final ? { completed_at: new Date().toISOString() } : {}),
        }).eq('id', count_id);
        return new Response(JSON.stringify({ success: true, prepared: 0, processed: 0, remaining: 0, done: true, zeroed_siblings: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const scannedRows = toCorrect.map((i) => ({
        count_id,
        count_item_id: i.id,
        store_id: storeId,
        product_id: String(i.product_id),
        product_name: i.product_name || 'Unknown',
        new_quantity: i.counted_quantity,
        old_quantity: i.current_stock ?? null,
      }));

      const queueRows = [...scannedRows, ...siblingZeroRows];

      const CHUNK = 200;
      for (let i = 0; i < queueRows.length; i += CHUNK) {
        const { error: insErr } = await supabase
          .from('inventory_correction_queue')
          .insert(queueRows.slice(i, i + CHUNK));
        if (insErr) throw insErr;
      }

      // Mark the count as correcting so the UI shows progress.
      await supabase.from('inventory_counts').update({
        status: final ? 'correcting' : 'smart_correcting',
        last_batch_at: new Date().toISOString(),
      }).eq('id', count_id);

      // Kick off the first processing batch in the background and return fast.
      queueNextBatch(supabaseUrl, anonKey, { count_id, batch_size, final });

      return new Response(JSON.stringify({
        success: true,
        prepared: queueRows.length,
        zeroed_siblings: siblingZeroRows.length,
        done: false,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


    // Atomically CLAIM a batch of pending items (marks them 'processing' and
    // bumps attempts in a single SQL statement with FOR UPDATE SKIP LOCKED).
    // This prevents two overlapping runs (e.g. a slow batch + a watchdog
    // re-trigger) from grabbing the same rows and writing duplicate history.
    const { data: items, error: fetchError } = await supabase
      .rpc('inventory_claim_correction_batch', { p_count_id: count_id, p_batch_size: batch_size });

    if (fetchError) throw fetchError;
    if (!items || items.length === 0) {
      const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

      const { count: activeProcessingCount } = await supabase
        .from('inventory_correction_queue')
        .select('*', { count: 'exact', head: true })
        .eq('count_id', count_id)
        .eq('status', 'processing')
        .lt('attempts', 5)
        .gte('updated_at', staleCutoff);

      if ((activeProcessingCount || 0) > 0) {
        // Another invocation already claimed the current batch and is still
        // fresh. Do not mark the count as finished; just let that run complete.
        return new Response(JSON.stringify({
          success: true,
          processed: 0,
          remaining: activeProcessingCount || 0,
          activeProcessing: true,
          done: false,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // All done. In FINAL mode the balance is closed (status=completed).
      // In incremental (smart) mode we return to 'counting' so the operator
      // keeps scanning/conferring the rest of the store.
      await supabase.from('inventory_counts').update(
        final
          ? { status: 'completed', completed_at: new Date().toISOString(), last_batch_at: new Date().toISOString() }
          : { status: 'counting', last_batch_at: new Date().toISOString() },
      ).eq('id', count_id);

      return new Response(JSON.stringify({ success: true, processed: 0, remaining: 0, done: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    let errors = 0;

    for (const item of items) {
      // Item is already claimed (status='processing', attempts bumped) by the
      // atomic RPC above — no per-row "mark processing" write needed.
      try {
        const nowIso = new Date().toISOString();
        const newQty = item.new_quantity;
        let updatedId: string | null = null;
        let lastUpdErr: string | null = null;

        // Identificadores do item de contagem (sku/barcode são a chave principal,
        // pois product_id pode ser nulo em contagens por bipagem de código de barras).
        const { data: ci } = await supabase
          .from('inventory_count_items')
          .select('sku, barcode')
          .eq('id', item.count_item_id)
          .maybeSingle();
        const ciSku = ci?.sku ? String(ci.sku).trim() : null;
        const ciBarcode = ci?.barcode ? String(ci.barcode).trim() : null;

        // tiny_id só é válido quando product_id é um número inteiro real
        // (Number(null) === 0, por isso checamos o formato antes).
        const tinyIdNum = item.product_id != null && /^\d+$/.test(String(item.product_id))
          ? Number(item.product_id)
          : null;

        // Atualiza pos_products por uma coluna específica + loja, capturando erros.
        const tryUpdate = async (column: string, value: string | number | null) => {
          if (value === null || value === undefined || value === '') return;
          const { data, error } = await supabase
            .from('pos_products')
            .update({ stock: newQty, synced_at: nowIso })
            .eq('store_id', item.store_id)
            .eq(column, value)
            .select('id');
          if (error) {
            lastUpdErr = error.message;
            console.error(`[correct] update by ${column}=${value} store=${item.store_id} error: ${error.message}`);
            return;
          }
          if (data && data.length > 0) updatedId = data[0].id;
        };

        // 1) tiny_id (quando existir)  2) sku  3) barcode
        if (tinyIdNum !== null) await tryUpdate('tiny_id', tinyIdNum);
        if (!updatedId) await tryUpdate('sku', ciSku);
        if (!updatedId) await tryUpdate('barcode', ciBarcode);

        if (!updatedId) {
          const errMsg = lastUpdErr
            ? `Falha ao atualizar pos_products: ${lastUpdErr}`
            : 'Produto não encontrado no estoque local (pos_products)';
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
          tiny_id: tinyIdNum,
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
          correction_status: 'corrected', corrected_at: nowIso, last_corrected_quantity: newQty
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
        queueNextBatch(supabaseUrl, anonKey, { count_id, batch_size, final });
        console.log(`Self-invoked for count_id=${count_id}, remaining ~${remaining - processed}, final=${final}`);
      } catch (e) {
        console.error('Self-invoke error:', e);
      }
    } else {
      // Last batch just finished the queue. Apply final status transition here too
      // (the empty-queue branch above only triggers on a fresh invoke with 0 items).
      await supabase.from('inventory_counts').update(
        final
          ? { status: 'completed', completed_at: new Date().toISOString(), last_batch_at: new Date().toISOString() }
          : { status: 'counting', last_batch_at: new Date().toISOString() },
      ).eq('id', count_id);
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
