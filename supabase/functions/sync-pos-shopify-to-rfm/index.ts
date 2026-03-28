import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function formatBRDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

async function safeJson(resp: Response) {
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch { return { retorno: { status: 'Erro', erros: [{ erro: text.substring(0, 200) }] } }; }
}

const TIME_LIMIT_MS = 55_000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const functionStart = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'all'; // 'pos', 'tiny', 'all'
    const months = body.months || 24; // default 24 months of history
    const resumePage = body.resume_page || 1; // for resuming interrupted syncs

    let posCount = 0;
    let tinyOnlineCount = 0;

    // ── 1. Sync POS completed sales ──
    if (mode === 'pos' || mode === 'all') {
      let allSales: any[] = [];
      let salesFrom = 0;
      const salesBatch = 1000;
      while (true) {
        const { data, error: salesErr } = await supabase
          .from('pos_sales')
          .select('id, customer_id, total, created_at, status, store_id')
          .in('status', ['completed', 'paid'])
          .range(salesFrom, salesFrom + salesBatch - 1);
        if (salesErr) throw salesErr;
        if (!data || data.length === 0) break;
        allSales = allSales.concat(data);
        if (data.length < salesBatch) break;
        salesFrom += salesBatch;
      }
      console.log(`POS: fetched ${allSales.length} sales`);

      if (allSales.length > 0) {
        const customerIds = [...new Set(allSales.filter(s => s.customer_id).map(s => s.customer_id))];
        let allCustomers: any[] = [];
        for (let ci = 0; ci < customerIds.length; ci += 50) {
          const idChunk = customerIds.slice(ci, ci + 50);
          const { data: custChunk } = await supabase
            .from('pos_customers')
            .select('id, name, email, whatsapp, city, state, gender, cpf, shoe_size, preferred_style, age_range')
            .in('id', idChunk);
          if (custChunk) allCustomers = allCustomers.concat(custChunk);
        }
        const customerMap = new Map(allCustomers.map(c => [c.id, c]));

        const customerSales = new Map<string, { total: number; count: number; first: string; last: string; storeId: string | null }>();
        for (const sale of allSales) {
          if (!sale.customer_id) continue;
          const existing = customerSales.get(sale.customer_id);
          if (existing) {
            existing.total += Number(sale.total || 0);
            existing.count += 1;
            if (sale.created_at < existing.first) existing.first = sale.created_at;
            if (sale.created_at > existing.last) { existing.last = sale.created_at; existing.storeId = sale.store_id || existing.storeId; }
          } else {
            customerSales.set(sale.customer_id, {
              total: Number(sale.total || 0), count: 1,
              first: sale.created_at, last: sale.created_at,
              storeId: sale.store_id || null,
            });
          }
        }

        const batch: any[] = [];
        for (const [custId, stats] of customerSales) {
          const cust = customerMap.get(custId);
          if (!cust) continue;
          const phone = (cust.whatsapp || '').replace(/\D/g, '');
          const cpf = (cust.cpf || '').replace(/\D/g, '') || null;
          if (!phone && !cust.email && !cpf) continue;

          const nameParts = (cust.name || '').split(' ');
          const ddd = phone.length >= 10 ? phone.slice(phone.startsWith('55') ? 2 : 0, phone.startsWith('55') ? 4 : 2) : null;

          batch.push({
            zoppy_id: `pos-${custId}`,
            external_id: custId,
            first_name: nameParts[0] || '',
            last_name: nameParts.slice(1).join(' ') || '',
            phone: phone || null, email: cust.email || null, cpf,
            city: cust.city || null, state: cust.state || null, gender: cust.gender || null,
            region_type: 'local', ddd,
            store_id: stats.storeId,
            shoe_size: cust.shoe_size || null, preferred_style: cust.preferred_style || null,
            age_range: cust.age_range || null,
            source: 'pos', lead_status: 'customer',
            total_orders: stats.count, total_spent: stats.total,
            avg_ticket: stats.count > 0 ? stats.total / stats.count : 0,
            first_purchase_at: stats.first, last_purchase_at: stats.last,
          });
        }

        for (let i = 0; i < batch.length; i += 100) {
          const chunk = batch.slice(i, i + 100);
          const { error } = await supabase.from('zoppy_customers').upsert(chunk, { onConflict: 'zoppy_id' });
          if (error) console.error('POS upsert error:', error);
          else posCount += chunk.length;
        }
      }
      console.log(`POS sync: ${posCount} customers upserted`);
    }

    // ── 2. Sync online sales from Tiny ERP (site) ──
    if (mode === 'tiny' || mode === 'all') {
      // Use the Tiny Shopify store token from pos_stores
      const { data: tinyShopifyStore } = await supabase
        .from('pos_stores')
        .select('id, name, tiny_token')
        .eq('name', 'Tiny Shopify')
        .single();
      
      const tinyToken = tinyShopifyStore?.tiny_token || Deno.env.get('TINY_ERP_TOKEN');
      if (!tinyToken) {
        console.warn('No Tiny token found for online sync');
      } else {
        console.log(`Using Tiny token from: ${tinyShopifyStore ? 'pos_stores (Tiny Shopify)' : 'env TINY_ERP_TOKEN'}`);
        const now = new Date();
        const dateFrom = new Date(now);
        dateFrom.setMonth(dateFrom.getMonth() - months);

        // Phase 1: Collect all orders from search (fast, no detail calls needed)
        // The search endpoint returns: id, numero, nome (customer name), valor, data_pedido, situacao
        const customerByName = new Map<string, {
          total: number; count: number; first: string; last: string;
        }>();

        let page = resumePage;
        let totalPages = 1;
        let totalOrdersFetched = 0;
        let apiCallCount = 0;

        console.log(`Tiny online: fetching orders from ${formatBRDate(dateFrom)} to ${formatBRDate(now)}`);

        // Phase 1: Scan all pages (only search endpoint, no detail calls)
        while (page <= totalPages && (Date.now() - functionStart) < TIME_LIMIT_MS - 15000) {
          const formParams: Record<string, string> = {
            token: tinyToken, formato: 'json', pagina: String(page),
            dataInicial: formatBRDate(dateFrom), dataFinal: formatBRDate(now),
          };
          const situacao = body.situacao || '';
          if (situacao) formParams.situacao = situacao;

          try {
            const resp = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams(formParams).toString(),
            });
            apiCallCount++;
            const data = await safeJson(resp);
            const retorno = data.retorno;

            if (retorno?.status === 'Erro') {
              console.log(`Tiny page ${page}: error - ${retorno?.erros?.[0]?.erro || 'unknown'}`);
              break;
            }
            if (!retorno?.pedidos || retorno.pedidos.length === 0) {
              console.log(`Tiny page ${page}: no orders`);
              break;
            }

            if (page === resumePage) {
              totalPages = retorno?.numero_paginas || 1;
            }

            for (const p of retorno.pedidos) {
              const pedido = p.pedido;
              if (!pedido) continue;
              totalOrdersFetched++;

              const customerName = (pedido.nome || '').trim();
              if (!customerName) continue;

              const orderTotal = parseFloat(pedido.valor || '0');
              const orderDate = pedido.data_pedido || pedido.dataPrevista || new Date().toISOString().slice(0, 10);

              const existing = customerByName.get(customerName);
              if (existing) {
                existing.total += orderTotal;
                existing.count += 1;
                if (orderDate < existing.first) existing.first = orderDate;
                if (orderDate > existing.last) existing.last = orderDate;
              } else {
                customerByName.set(customerName, {
                  total: orderTotal, count: 1, first: orderDate, last: orderDate,
                });
              }
            }

            console.log(`Tiny page ${page}/${totalPages}: ${retorno.pedidos.length} orders, ${customerByName.size} unique customers so far`);
            page++;
            await new Promise(r => setTimeout(r, 350));
          } catch (e) {
            console.error(`Tiny page ${page} error:`, e);
            break;
          }
        }

        console.log(`Phase 1 done: ${totalOrdersFetched} orders, ${customerByName.size} unique customers`);

        // Phase 2: Fetch contact details for each unique customer (by name)
        const customerAgg = new Map<string, {
          name: string; email: string | null; phone: string | null; cpf: string | null;
          city: string | null; state: string | null;
          total: number; count: number; first: string; last: string;
        }>();

        const customerNames = [...customerByName.entries()];
        let contactsFetched = 0;

        for (const [customerName, stats] of customerNames) {
          if ((Date.now() - functionStart) > TIME_LIMIT_MS - 5000) break;

          await new Promise(r => setTimeout(r, 400));

          try {
            const contactResp = await fetch('https://api.tiny.com.br/api2/contatos.pesquisa.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: tinyToken, formato: 'json', pesquisa: customerName }).toString(),
            });
            apiCallCount++;
            const contactData = await safeJson(contactResp);
            const contatos = contactData.retorno?.contatos || [];

            if (contatos.length > 0) {
              const contato = contatos[0].contato;
              const phone = (contato?.fone || contato?.celular || '').replace(/\D/g, '');
              const cpf = (contato?.cpf_cnpj || '').replace(/\D/g, '') || null;
              const email = contato?.email || null;

              const key = cpf || phone || email || customerName;
              if (!key) continue;

              const existingAgg = customerAgg.get(key);
              if (existingAgg) {
                existingAgg.total += stats.total;
                existingAgg.count += stats.count;
                if (stats.first < existingAgg.first) existingAgg.first = stats.first;
                if (stats.last > existingAgg.last) existingAgg.last = stats.last;
              } else {
                customerAgg.set(key, {
                  name: customerName,
                  email, phone: phone || null, cpf,
                  city: contato?.cidade || null, state: contato?.uf || null,
                  total: stats.total, count: stats.count,
                  first: stats.first, last: stats.last,
                });
              }
              contactsFetched++;
            } else {
              // No contact found, use name as key
              customerAgg.set(customerName, {
                name: customerName, email: null, phone: null, cpf: null,
                city: null, state: null,
                total: stats.total, count: stats.count,
                first: stats.first, last: stats.last,
              });
            }
          } catch (e) {
            console.error(`Contact lookup error for ${customerName}:`, e);
          }
        }

        const timeRanOut = (Date.now() - functionStart) >= TIME_LIMIT_MS - 5000;
        console.log(`Phase 2 done: ${contactsFetched} contacts found, ${customerAgg.size} aggregated customers, ${apiCallCount} total API calls${timeRanOut ? ' (TIME LIMIT)' : ''}`);

        // Upsert aggregated customers
        const batch: any[] = [];
        for (const [key, stats] of customerAgg) {
          const phone = stats.phone || '';
          const nameParts = (stats.name || '').split(' ');
          const ddd = phone.length >= 10 ? phone.slice(phone.startsWith('55') ? 2 : 0, phone.startsWith('55') ? 4 : 2) : null;

          batch.push({
            zoppy_id: `tiny-online-${key}`,
            first_name: nameParts[0] || '',
            last_name: nameParts.slice(1).join(' ') || '',
            phone: phone || null,
            email: stats.email || null,
            cpf: stats.cpf || null,
            city: stats.city || null,
            state: stats.state || null,
            region_type: 'online',
            ddd,
            source: 'tiny_online',
            lead_status: 'customer',
            total_orders: stats.count,
            total_spent: stats.total,
            avg_ticket: stats.count > 0 ? stats.total / stats.count : 0,
            first_purchase_at: stats.first,
            last_purchase_at: stats.last,
          });
        }

        for (let i = 0; i < batch.length; i += 100) {
          const chunk = batch.slice(i, i + 100);
          const { error } = await supabase.from('zoppy_customers').upsert(chunk, { onConflict: 'zoppy_id' });
          if (error) console.error('Tiny online upsert error:', error);
          else tinyOnlineCount += chunk.length;
        }

        console.log(`Tiny online sync: ${tinyOnlineCount} customers upserted`);

        // If time ran out, return resume info
        if (timeRanOut) {
          return new Response(JSON.stringify({
            success: true,
            partial: true,
            resume_page: page,
            total_pages: totalPages,
            pos_customers_synced: posCount,
            tiny_online_customers_synced: tinyOnlineCount,
            message: `⏳ Sincronização parcial. POS: ${posCount}, Tiny Online: ${tinyOnlineCount}. Reenvie com resume_page=${page} para continuar.`,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

    // ── 3. Recalculate RFM ──
    if (body.recalculate_rfm !== false) {
      try {
        const rfmRes = await fetch(`${supabaseUrl}/functions/v1/zoppy-sync-customers`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mode: 'calculate_rfm' }),
        });
        const rfmData = await rfmRes.json();
        console.log('RFM recalculated:', rfmData.message || rfmData);
      } catch (rfmErr) {
        console.warn('RFM recalc failed:', rfmErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      pos_customers_synced: posCount,
      tiny_online_customers_synced: tinyOnlineCount,
      message: `✅ POS: ${posCount} clientes, Tiny Online: ${tinyOnlineCount} clientes sincronizados ao RFM`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
