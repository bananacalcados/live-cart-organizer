import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Very conservative: 35s to guarantee we save progress before the 60s platform kill
const MAX_EXECUTION_MS = 35_000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const startTime = Date.now();

  try {
    const { store_id, resume_page, resume_log_id } = await req.json();

    let stores: { id: string; tiny_token: string }[] = [];
    if (store_id) {
      const { data, error } = await supabase
        .from('pos_stores')
        .select('id, tiny_token')
        .eq('id', store_id)
        .single();
      if (error || !data?.tiny_token) throw new Error('Store not found or token not configured');
      stores = [data];
    } else {
      const { data } = await supabase.from('pos_stores').select('id, tiny_token').not('tiny_token', 'is', null);
      stores = data || [];
    }

    const results: any[] = [];

    for (const store of stores) {
      const startPage = (store_id && resume_page) ? resume_page : 1;
      let logId = resume_log_id || null;

      // Get previous synced count when resuming
      let previousSynced = 0;
      if (logId) {
        const { data: existingLog } = await supabase
          .from('pos_product_sync_log')
          .select('products_synced')
          .eq('id', logId)
          .maybeSingle();
        previousSynced = existingLog?.products_synced || 0;
      }

      // Create or reuse sync log
      if (!logId) {
        const { data: logEntry } = await supabase
          .from('pos_product_sync_log')
          .insert({ store_id: store.id, status: 'running', products_synced: 0 })
          .select('id')
          .single();
        logId = logEntry?.id;
      } else {
        // Mark as running again on resume
        await supabase.from('pos_product_sync_log').update({ status: 'running' }).eq('id', logId);
      }

      try {
        const token = store.tiny_token;

        // Get total pages from first request
        const countResp = await fetch('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&pagina=1`,
        });
        const countData = await countResp.json();
        const totalPages = parseInt(countData.retorno?.numero_paginas || '1');
        const totalRecords = totalPages * 100;

        if (logId && startPage === 1) {
          await supabase.from('pos_product_sync_log').update({
            total_products: totalRecords,
          }).eq('id', logId);
        }

        let page = startPage;
        let totalSynced = 0; // count for THIS execution
        let hasMore = true;
        let timedOut = false;

        // Reuse page 1 data if starting from page 1
        let cachedFirstPage = startPage === 1 ? countData : null;

        while (hasMore) {
          // Check time budget BEFORE starting a new page
          if (Date.now() - startTime > MAX_EXECUTION_MS) {
            timedOut = true;
            break;
          }

          let searchData;
          if (page === 1 && cachedFirstPage) {
            searchData = cachedFirstPage;
          } else {
            const searchResp = await fetch('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `token=${token}&formato=json&pagina=${page}`,
            });
            searchData = await searchResp.json();
          }

          if (searchData.retorno?.status === 'Erro') {
            hasMore = false;
            break;
          }

          const rawProducts = searchData.retorno?.produtos || [];
          if (rawProducts.length === 0) {
            hasMore = false;
            break;
          }

          // Process products in batches of 3 (reduced from 5 to respect Tiny rate limits)
          for (let i = 0; i < rawProducts.length; i += 3) {
            if (Date.now() - startTime > MAX_EXECUTION_MS) {
              timedOut = true;
              break;
            }

            const batch = rawProducts.slice(i, i + 3);
            const batchPromises = batch.map(async (item: any) => {
              const p = item.produto;
              try {
                const detailResp = await fetch('https://api.tiny.com.br/api2/produto.obter.php', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: `token=${token}&formato=json&id=${p.id}`,
                });
                const detailData = await detailResp.json();
                const full = detailData.retorno?.produto;
                if (!full) return 0;

                const variations = full.variacoes || [];
                const rows: any[] = [];

                if (variations.length > 0) {
                  for (const v of variations) {
                    const variation = v.variacao;
                    rows.push({
                      store_id: store.id,
                      tiny_id: full.id,
                      sku: variation.codigo || full.codigo || '',
                      name: full.nome,
                      variant: variation.grade?.tamanho
                        ? `${variation.grade?.cor || ''} ${variation.grade?.tamanho || ''}`.trim()
                        : variation.variacao || '',
                      size: variation.grade?.tamanho || null,
                      color: variation.grade?.cor || null,
                      category: full.classe_produto || null,
                      price: parseFloat(variation.preco || full.preco || '0'),
                      barcode: variation.gtin || full.gtin || '',
                      stock: parseFloat(variation.estoqueAtual || full.estoqueAtual || '0'),
                      image_url: full.anexos?.[0]?.anexo?.url || null,
                      is_active: full.situacao === 'A',
                      synced_at: new Date().toISOString(),
                    });
                  }
                } else {
                  rows.push({
                    store_id: store.id,
                    tiny_id: full.id,
                    sku: full.codigo || '',
                    name: full.nome,
                    variant: '',
                    size: null,
                    color: null,
                    category: full.classe_produto || null,
                    price: parseFloat(full.preco || '0'),
                    barcode: full.gtin || '',
                    stock: parseFloat(full.estoqueAtual || '0'),
                    image_url: full.anexos?.[0]?.anexo?.url || null,
                    is_active: full.situacao === 'A',
                    synced_at: new Date().toISOString(),
                  });
                }

                // Upsert all rows for this product at once
                await supabase
                  .from('pos_products')
                  .upsert(rows, { onConflict: 'store_id,tiny_id,sku,variant' });

                return rows.length;
              } catch (e) {
                console.error('Error syncing product:', p.id, e);
                return 0;
              }
            });

            const counts = await Promise.all(batchPromises);
            totalSynced += counts.reduce((a, b) => a + b, 0);

            // Update progress every batch (cumulative with previous runs)
            if (logId) {
              await supabase.from('pos_product_sync_log').update({
                products_synced: previousSynced + totalSynced,
              }).eq('id', logId);
            }

            // Increased delay between batches to respect Tiny API rate limits
            await new Promise(r => setTimeout(r, 500));
          }

          if (timedOut) break;

          page++;
          if (rawProducts.length < 100) hasMore = false;
        }

        if (timedOut) {
          // Save progress so frontend can resume
          if (logId) {
            await supabase.from('pos_product_sync_log').update({
              status: 'partial',
              products_synced: previousSynced + totalSynced,
              error_message: JSON.stringify({ resume_page: page, resume_log_id: logId }),
            }).eq('id', logId);
          }
          results.push({
            store_id: store.id,
            products_synced: previousSynced + totalSynced,
            status: 'partial',
            resume_page: page,
            resume_log_id: logId,
            total_pages: totalPages,
          });
        } else {
          if (logId) {
            await supabase.from('pos_product_sync_log').update({
              status: 'completed',
              products_synced: previousSynced + totalSynced,
              completed_at: new Date().toISOString(),
            }).eq('id', logId);
          }
          results.push({ store_id: store.id, products_synced: previousSynced + totalSynced, status: 'completed' });
        }
      } catch (e) {
        console.error('Sync error for store:', store.id, e);
        if (logId) {
          await supabase.from('pos_product_sync_log').update({
            status: 'error',
            error_message: (e as Error).message,
            completed_at: new Date().toISOString(),
          }).eq('id', logId);
        }
        results.push({ store_id: store.id, status: 'error', error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
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
