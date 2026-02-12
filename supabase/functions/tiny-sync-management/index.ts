import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function parseBRDate(str: string): Date {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(y, m - 1, d);
}

function formatBRDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

function formatISO(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const TIME_LIMIT_MS = 55_000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const functionStart = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { store_id, date_from, date_to, sync_stock, stock_only, resume_stock_page, resume_log_id, resume_date } = body;

    let stores: { id: string; name: string; tiny_token: string }[] = [];
    if (store_id) {
      const { data, error } = await supabase
        .from('pos_stores').select('id, name, tiny_token').eq('id', store_id).single();
      if (error || !data?.tiny_token) throw new Error('Store not found');
      stores = [data];
    } else {
      const { data } = await supabase.from('pos_stores').select('id, name, tiny_token').not('tiny_token', 'is', null).eq('is_active', true);
      stores = data || [];
    }

    const results: any[] = [];

    for (const store of stores) {
      if (Date.now() - functionStart > TIME_LIMIT_MS) {
        results.push({ store_id: store.id, store_name: store.name, status: 'skipped' });
        continue;
      }

      // Resume or create log
      let logId = resume_log_id || null;
      if (!logId) {
        const { data: logEntry } = await supabase
          .from('tiny_management_sync_log')
          .insert({
            store_id: store.id, sync_type: stock_only ? 'stock' : 'orders',
            status: 'running', date_from, date_to,
            phase: stock_only ? 'stock' : 'orders',
            current_date_syncing: stock_only ? 'Estoque: iniciando...' : (date_from || 'Iniciando...'),
          })
          .select('id').single();
        logId = logEntry?.id;
      } else {
        await supabase.from('tiny_management_sync_log').update({ status: 'running' }).eq('id', logId);
      }

      try {
        const token = store.tiny_token;
        let totalSynced = 0;

        // ===== PHASE 1: Orders (skip if stock_only) =====
        if (!stock_only) {
          const startDate = resume_date 
            ? parseBRDate(resume_date) 
            : parseBRDate(date_from || new Date(Date.now() - 30 * 86400000).toLocaleDateString('pt-BR'));
          const endDate = parseBRDate(date_to || new Date().toLocaleDateString('pt-BR'));
          let currentDate = new Date(startDate);

          while (currentDate <= endDate && Date.now() - functionStart < TIME_LIMIT_MS) {
            const dayStr = formatBRDate(currentDate);
            if (logId) {
              await supabase.from('tiny_management_sync_log').update({
                current_date_syncing: dayStr, orders_synced: totalSynced,
              }).eq('id', logId);
            }

            let page = 1, hasMore = true;
            while (hasMore && Date.now() - functionStart < TIME_LIMIT_MS) {
              const resp = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  token, formato: 'json', pagina: String(page),
                  dataInicial: dayStr, dataFinal: dayStr,
                }).toString(),
              });
              const data = await resp.json();
              if (data.retorno?.status === 'Erro') { hasMore = false; break; }

              const totalPages = parseInt(data.retorno?.numero_paginas || '1');
              const orders = data.retorno?.pedidos || [];
              if (orders.length === 0) { hasMore = false; break; }

              const rows: any[] = [];
              for (const item of orders) {
                if (Date.now() - functionStart > TIME_LIMIT_MS) break;
                const o = item.pedido;
                try {
                  await new Promise(r => setTimeout(r, 600));
                  const dr = await fetch('https://api.tiny.com.br/api2/pedido.obter.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `token=${token}&formato=json&id=${o.id}`,
                  });
                  const dd = await dr.json();
                  const full = dd.retorno?.pedido;
                  if (full) {
                    const items = (full.itens || []).map((i: any) => ({
                      name: i.item?.descricao || '', sku: i.item?.codigo || '',
                      quantity: parseFloat(i.item?.quantidade || '1'),
                      unit_price: parseFloat(i.item?.valor_unitario || '0'),
                      total: parseFloat(i.item?.valor_unitario || '0') * parseFloat(i.item?.quantidade || '1'),
                    }));
                    rows.push({
                      store_id: store.id, tiny_order_id: String(full.id || o.id),
                      tiny_order_number: String(full.numero || o.numero || ''),
                      order_date: formatISO(currentDate),
                      customer_name: full.cliente?.nome || o.nome_comprador || null,
                      status: full.situacao || o.situacao || 'aprovado',
                      payment_method: full.forma_pagamento || null,
                      subtotal: parseFloat(full.totalProdutos || full.total_pedido || '0'),
                      discount: parseFloat(full.desconto || '0'),
                      shipping: parseFloat(full.total_frete || '0'),
                      total: parseFloat(full.total_pedido || o.valor || '0'),
                      items: JSON.stringify(items), raw_data: full,
                      synced_at: new Date().toISOString(),
                    });
                  }
                } catch (e) {
                  console.error(`Order ${o.id}:`, e);
                  rows.push({
                    store_id: store.id, tiny_order_id: String(o.id),
                    tiny_order_number: String(o.numero || ''), order_date: formatISO(currentDate),
                    customer_name: o.nome_comprador || null, status: o.situacao || 'aprovado',
                    payment_method: null, subtotal: parseFloat(o.valor || '0'),
                    discount: 0, shipping: 0, total: parseFloat(o.valor || '0'),
                    items: '[]', synced_at: new Date().toISOString(),
                  });
                }
              }
              if (rows.length > 0) {
                await supabase.from('tiny_synced_orders').upsert(rows, { onConflict: 'store_id,tiny_order_id' });
              }
              totalSynced += rows.length;
              page++;
              if (page > totalPages) hasMore = false;
            }
            currentDate = addDays(currentDate, 1);
            await new Promise(r => setTimeout(r, 400));
          }

          // If orders timed out before finishing all dates, return partial
          if (currentDate <= endDate && Date.now() - functionStart >= TIME_LIMIT_MS) {
            if (logId) {
              await supabase.from('tiny_management_sync_log').update({
                status: 'partial',
                current_date_syncing: `Parcial: parou em ${formatBRDate(currentDate)}`,
                orders_synced: totalSynced,
              }).eq('id', logId);
            }
            results.push({
              store_id: store.id, store_name: store.name, status: 'partial',
              orders_synced: totalSynced,
              resume_date: formatBRDate(currentDate),
              resume_log_id: logId,
            });
            continue;
          }
        }

        // ===== PHASE 2: Stock — fetch from pos_products cache, call Tiny API with proper rate limiting =====
        if ((sync_stock || stock_only) && Date.now() - functionStart < TIME_LIMIT_MS) {
          if (logId) {
            await supabase.from('tiny_management_sync_log').update({
              phase: 'stock', current_date_syncing: 'Estoque: carregando produtos...',
            }).eq('id', logId);
          }

          // Get total count of products for this store
          const { count: totalProducts } = await supabase
            .from('pos_products')
            .select('*', { count: 'exact', head: true })
            .eq('store_id', store.id)
            .eq('is_active', true);

          const totalProds = totalProducts || 0;
          const PAGE_SIZE = 100;
          const totalStockPages = Math.ceil(totalProds / PAGE_SIZE);
          let stockPage = resume_stock_page || 0; // 0-indexed offset pages
          let stockTimedOut = false;
          let stockUpdated = (resume_stock_page || 0) * PAGE_SIZE; // estimate previous progress
          const BATCH_SIZE = 5; // parallel API calls per batch
          const BATCH_DELAY = 4000; // 4s between batches — ~75 req/min burst, well within Tiny limits

          while (!stockTimedOut && Date.now() - functionStart < TIME_LIMIT_MS) {
            // Fetch a page of products from local cache
            const { data: cachedProducts } = await supabase
              .from('pos_products')
              .select('tiny_id')
              .eq('store_id', store.id)
              .eq('is_active', true)
              .order('tiny_id')
              .range(stockPage * PAGE_SIZE, (stockPage + 1) * PAGE_SIZE - 1);

            if (!cachedProducts || cachedProducts.length === 0) break;

            const now = new Date().toISOString();

            // Process in batches of BATCH_SIZE with proper rate limiting
            for (let i = 0; i < cachedProducts.length; i += BATCH_SIZE) {
              if (Date.now() - functionStart > TIME_LIMIT_MS) { stockTimedOut = true; break; }
              const batch = cachedProducts.slice(i, i + BATCH_SIZE);

              const stockResults = await Promise.all(
                batch.map(async (prod) => {
                  try {
                    const sr = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                      body: `token=${token}&formato=json&id=${prod.tiny_id}`,
                    });
                    const sd = await sr.json();
                    if (sd.retorno?.status !== 'Erro') {
                      return { tinyId: String(prod.tiny_id), stock: parseFloat(sd.retorno?.produto?.saldo || '0') };
                    }
                  } catch (e) {
                    // Silently fail, keep existing stock
                  }
                  return null; // Don't update if API failed
                })
              );

              // Only update products that got a successful response
              const successful = stockResults.filter(r => r !== null);
              if (successful.length > 0) {
                const dbUpdates = successful.map(r =>
                  supabase.from('pos_products').update({
                    stock: r!.stock,
                    synced_at: now,
                  }).eq('store_id', store.id).eq('tiny_id', r!.tinyId)
                );
                await Promise.all(dbUpdates);
              }
              stockUpdated += batch.length;

              // Respect Tiny rate limit (~30 req/min)
              if (i + BATCH_SIZE < cachedProducts.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
              }
            }

            const pct = totalStockPages > 0 ? Math.round(((stockPage + 1) / totalStockPages) * 100) : 100;
            if (logId) {
              await supabase.from('tiny_management_sync_log').update({
                current_date_syncing: `Estoque: ${pct}% (${stockUpdated}/${totalProds} produtos)`,
              }).eq('id', logId);
            }

            if (Date.now() - functionStart > TIME_LIMIT_MS) { stockTimedOut = true; break; }
            stockPage++;
            if (stockPage >= totalStockPages) break;
          }

          // If we timed out, save resume point
          if (stockTimedOut || (Date.now() - functionStart >= TIME_LIMIT_MS && stockPage < totalStockPages)) {
            const pct = totalStockPages > 0 ? Math.round((stockPage / totalStockPages) * 100) : 0;
            if (logId) {
              await supabase.from('tiny_management_sync_log').update({
                status: 'partial',
                current_date_syncing: `Estoque parcial: ${pct}% (${stockUpdated}/${totalProds})`,
                orders_synced: totalSynced,
              }).eq('id', logId);
            }
            results.push({
              store_id: store.id, store_name: store.name, status: 'partial',
              orders_synced: totalSynced, stock_updated: stockUpdated,
              resume_stock_page: stockPage, resume_log_id: logId,
            });
            continue;
          }
        }

        // Mark complete
        if (logId) {
          await supabase.from('tiny_management_sync_log').update({
            status: 'completed', orders_synced: totalSynced,
            phase: 'done', current_date_syncing: null,
            completed_at: new Date().toISOString(),
          }).eq('id', logId);
        }
        results.push({ store_id: store.id, store_name: store.name, orders_synced: totalSynced, status: 'completed' });

      } catch (e) {
        console.error(`Sync error ${store.name}:`, e);
        if (logId) {
          await supabase.from('tiny_management_sync_log').update({
            status: 'error', error_message: (e as Error).message,
            completed_at: new Date().toISOString(),
          }).eq('id', logId);
        }
        results.push({ store_id: store.id, store_name: store.name, status: 'error', error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
