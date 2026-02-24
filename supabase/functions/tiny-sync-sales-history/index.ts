import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

async function safeJson(resp: Response) {
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch { return { retorno: { status: 'Erro', status_processamento: '3', erros: [{ erro: text.substring(0, 200) }] } }; }
}

const TIME_LIMIT_MS = 55_000;
const BATCH_SIZE = 100;

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
    const { store_id, months = 6 } = body;

    if (!store_id) throw new Error('store_id required');

    const { data: store, error: storeErr } = await supabase
      .from('pos_stores').select('id, name, tiny_token').eq('id', store_id).single();
    if (storeErr || !store?.tiny_token) throw new Error('Store not found or no Tiny token');

    const token = store.tiny_token;
    const now = new Date();
    const dateFrom = new Date(now);
    dateFrom.setMonth(dateFrom.getMonth() - months);
    
    const periodStart = formatISO(dateFrom);
    const periodEnd = formatISO(now);

    // Aggregate SKU sales from Tiny orders
    const skuSales = new Map<string, { name: string; qty: number; revenue: number; count: number }>();
    let page = 1;
    let totalPages = 1;
    let totalOrders = 0;

    while (page <= totalPages && (Date.now() - functionStart) < TIME_LIMIT_MS) {
      const url = `https://api.tiny.com.br/api2/pedidos.pesquisa.php?token=${token}&formato=json&pagina=${page}&dataInicial=${formatBRDate(dateFrom)}&dataFinal=${formatBRDate(now)}&situacao=Faturado`;
      
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 20000);
      
      try {
        const resp = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timeout);
        const data = await safeJson(resp);
        
        const retorno = data.retorno;
        if (retorno?.status === 'Erro' || retorno?.status_processamento === '3') {
          console.log(`Page ${page} error or no more data`);
          break;
        }
        
        const pedidos = retorno?.pedidos || [];
        if (page === 1) {
          totalPages = retorno?.numero_paginas || 1;
        }

        // For each order, fetch details to get items
        for (const p of pedidos) {
          if ((Date.now() - functionStart) > TIME_LIMIT_MS) break;
          
          const orderId = p.pedido?.id;
          if (!orderId) continue;
          totalOrders++;

          try {
            const detailUrl = `https://api.tiny.com.br/api2/pedido.obter.php?token=${token}&formato=json&id=${orderId}`;
            const detailCtrl = new AbortController();
            const detailTimeout = setTimeout(() => detailCtrl.abort(), 15000);
            
            const detailResp = await fetch(detailUrl, { signal: detailCtrl.signal });
            clearTimeout(detailTimeout);
            const detailData = await safeJson(detailResp);
            
            const pedidoDetail = detailData.retorno?.pedido;
            if (!pedidoDetail?.itens) continue;

            for (const itemWrapper of pedidoDetail.itens) {
              const item = itemWrapper.item;
              if (!item?.codigo) continue;
              
              const sku = item.codigo;
              const qty = parseFloat(item.quantidade || '0');
              const unitPrice = parseFloat(item.valor_unitario || '0');
              
              const existing = skuSales.get(sku) || { name: item.descricao || '', qty: 0, revenue: 0, count: 0 };
              existing.qty += qty;
              existing.revenue += qty * unitPrice;
              existing.count += 1;
              skuSales.set(sku, existing);
            }
          } catch (e) {
            console.error(`Error fetching order ${orderId}:`, e);
          }

          // Small delay to avoid API rate limits
          await new Promise(r => setTimeout(r, 200));
        }
        
        page++;
      } catch (e) {
        clearTimeout(timeout);
        console.error(`Page ${page} fetch error:`, e);
        break;
      }
    }

    // Upsert results into tiny_sales_history
    const rows = [...skuSales.entries()].map(([sku, data]) => ({
      store_id: store.id,
      sku,
      product_name: data.name,
      quantity_sold: data.qty,
      total_revenue: data.revenue,
      sale_count: data.count,
      period_start: periodStart,
      period_end: periodEnd,
      last_synced_at: new Date().toISOString(),
    }));

    // Batch upsert
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('tiny_sales_history')
        .upsert(batch as any, { onConflict: 'store_id,sku,period_start' });
      if (error) console.error('Upsert error:', error);
      else upserted += batch.length;
    }

    return new Response(JSON.stringify({
      success: true,
      total_orders_processed: totalOrders,
      total_skus: skuSales.size,
      upserted,
      pages_processed: page - 1,
      total_pages: totalPages,
      period: { from: periodStart, to: periodEnd },
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
