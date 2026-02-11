import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Parse DD/MM/YYYY to Date
function parseBRDate(str: string): Date {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(y, m - 1, d);
}

// Format Date to DD/MM/YYYY
function formatBRDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

// Format Date to YYYY-MM-DD
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { store_id, date_from, date_to, sync_stock } = body;

    // Get stores
    let stores: { id: string; name: string; tiny_token: string }[] = [];
    if (store_id) {
      const { data, error } = await supabase
        .from('pos_stores')
        .select('id, name, tiny_token')
        .eq('id', store_id)
        .single();
      if (error || !data?.tiny_token) throw new Error('Store not found or token not configured');
      stores = [data];
    } else {
      const { data } = await supabase.from('pos_stores').select('id, name, tiny_token').not('tiny_token', 'is', null).eq('is_active', true);
      stores = data || [];
    }

    const results: any[] = [];

    // Calculate total days for progress
    const startDate = parseBRDate(date_from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR'));
    const endDate = parseBRDate(date_to || new Date().toLocaleDateString('pt-BR'));
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    for (const store of stores) {
      // Create sync log
      const { data: logEntry } = await supabase
        .from('tiny_management_sync_log')
        .insert({
          store_id: store.id,
          sync_type: 'orders',
          status: 'running',
          date_from: date_from,
          date_to: date_to,
          phase: 'orders',
          current_date_syncing: formatBRDate(startDate),
        })
        .select('id')
        .single();

      try {
        const token = store.tiny_token;
        let totalSynced = 0;
        let daysProcessed = 0;

        // Sync day by day
        let currentDate = new Date(startDate);
        
        while (currentDate <= endDate) {
          const dayStr = formatBRDate(currentDate);
          
          // Update log with current date
          if (logEntry?.id) {
            await supabase.from('tiny_management_sync_log').update({
              current_date_syncing: dayStr,
              orders_synced: totalSynced,
            }).eq('id', logEntry.id);
          }

          // Fetch orders for this specific day
          let page = 1;
          let hasMore = true;

          while (hasMore) {
            const params = new URLSearchParams({
              token,
              formato: 'json',
              pagina: String(page),
              dataInicial: dayStr,
              dataFinal: dayStr,
              situacao: 'aprovado',
            });

            const resp = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: params.toString(),
            });

            const data = await resp.json();

            if (data.retorno?.status === 'Erro') {
              hasMore = false;
              break;
            }

            const totalPages = parseInt(data.retorno?.numero_paginas || '1');
            const orders = data.retorno?.pedidos || [];

            if (orders.length === 0) {
              hasMore = false;
              break;
            }

            const rows: any[] = [];

            for (const item of orders) {
              const o = item.pedido;
              
              try {
                await new Promise(r => setTimeout(r, 600));
                const detailResp = await fetch('https://api.tiny.com.br/api2/pedido.obter.php', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: `token=${token}&formato=json&id=${o.id}`,
                });
                const detailData = await detailResp.json();
                const full = detailData.retorno?.pedido;

                if (full) {
                  const orderDate = formatISO(currentDate);
                  const items = (full.itens || []).map((i: any) => ({
                    name: i.item?.descricao || '',
                    sku: i.item?.codigo || '',
                    quantity: parseFloat(i.item?.quantidade || '1'),
                    unit_price: parseFloat(i.item?.valor_unitario || '0'),
                    total: parseFloat(i.item?.valor_unitario || '0') * parseFloat(i.item?.quantidade || '1'),
                  }));

                  rows.push({
                    store_id: store.id,
                    tiny_order_id: String(full.id || o.id),
                    tiny_order_number: String(full.numero || o.numero || ''),
                    order_date: orderDate,
                    customer_name: full.cliente?.nome || o.nome_comprador || null,
                    status: full.situacao || o.situacao || 'aprovado',
                    payment_method: full.forma_pagamento || null,
                    subtotal: parseFloat(full.totalProdutos || full.total_pedido || '0'),
                    discount: parseFloat(full.desconto || '0'),
                    shipping: parseFloat(full.total_frete || '0'),
                    total: parseFloat(full.total_pedido || o.valor || '0'),
                    items: JSON.stringify(items),
                    raw_data: full,
                    synced_at: new Date().toISOString(),
                  });
                }
              } catch (e) {
                console.error(`Error fetching order ${o.id}:`, e);
                rows.push({
                  store_id: store.id,
                  tiny_order_id: String(o.id),
                  tiny_order_number: String(o.numero || ''),
                  order_date: formatISO(currentDate),
                  customer_name: o.nome_comprador || null,
                  status: o.situacao || 'aprovado',
                  payment_method: null,
                  subtotal: parseFloat(o.valor || '0'),
                  discount: 0,
                  shipping: 0,
                  total: parseFloat(o.valor || '0'),
                  items: '[]',
                  synced_at: new Date().toISOString(),
                });
              }
            }

            if (rows.length > 0) {
              const { error: upsertErr } = await supabase
                .from('tiny_synced_orders')
                .upsert(rows, { onConflict: 'store_id,tiny_order_id' });
              if (upsertErr) console.error('Upsert error:', upsertErr);
            }

            totalSynced += rows.length;
            page++;
            if (page > totalPages) hasMore = false;
          }

          daysProcessed++;
          currentDate = addDays(currentDate, 1);

          // Rate limit between days
          await new Promise(r => setTimeout(r, 400));
        }

        // Sync stock/cost if requested
        if (sync_stock) {
          if (logEntry?.id) {
            await supabase.from('tiny_management_sync_log').update({
              phase: 'stock',
              current_date_syncing: 'Atualizando estoque...',
            }).eq('id', logEntry.id);
          }

          let stockPage = 1;
          let stockHasMore = true;
          let stockUpdated = 0;

          while (stockHasMore && stockUpdated < 300) {
            const resp = await fetch('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `token=${token}&formato=json&pagina=${stockPage}`,
            });
            const data = await resp.json();

            if (data.retorno?.status === 'Erro') { stockHasMore = false; break; }

            const totalPages = parseInt(data.retorno?.numero_paginas || '1');
            const products = data.retorno?.produtos || [];

            if (products.length === 0) { stockHasMore = false; break; }

            for (const item of products.slice(0, 15)) {
              const p = item.produto;
              try {
                await new Promise(r => setTimeout(r, 600));
                const detailResp = await fetch('https://api.tiny.com.br/api2/produto.obter.php', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: `token=${token}&formato=json&id=${p.id}`,
                });
                const detailData = await detailResp.json();
                const full = detailData.retorno?.produto;

                if (full) {
                  const costPrice = parseFloat(full.preco_custo || '0');
                  const sellPrice = parseFloat(full.preco || '0');
                  const stock = parseFloat(full.estoqueAtual || '0');

                  await supabase
                    .from('pos_products')
                    .update({ 
                      cost_price: costPrice, 
                      stock, 
                      price: sellPrice > 0 ? sellPrice : undefined,
                      synced_at: new Date().toISOString() 
                    })
                    .eq('store_id', store.id)
                    .eq('tiny_id', p.id);
                  
                  stockUpdated++;
                }
              } catch (e) {
                console.error(`Error getting product ${p.id}:`, e);
              }
            }

            if (logEntry?.id) {
              await supabase.from('tiny_management_sync_log').update({
                current_date_syncing: `Estoque: ${stockUpdated} produtos atualizados`,
              }).eq('id', logEntry.id);
            }

            stockPage++;
            if (stockPage > totalPages) stockHasMore = false;
          }
        }

        // Mark complete
        if (logEntry?.id) {
          await supabase.from('tiny_management_sync_log').update({
            status: 'completed',
            orders_synced: totalSynced,
            phase: 'done',
            current_date_syncing: null,
            completed_at: new Date().toISOString(),
          }).eq('id', logEntry.id);
        }

        results.push({ store_id: store.id, store_name: store.name, orders_synced: totalSynced, status: 'completed' });
      } catch (e) {
        console.error(`Sync error for store ${store.name}:`, e);
        if (logEntry?.id) {
          await supabase.from('tiny_management_sync_log').update({
            status: 'error',
            error_message: (e as Error).message,
            completed_at: new Date().toISOString(),
          }).eq('id', logEntry.id);
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
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
