// Auditoria do estoque real nas 3 contas Tiny
// Pagina produtos.pesquisa.php em cada conta, agrega quantidade, custo e venda totais
// Throttle 2.2s entre chamadas para respeitar rate limit Tiny (~30 req/min)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const maxPagesPerStore: number = body.max_pages ?? 200; // safety cap

    const { data: stores } = await supabase
      .from('pos_stores')
      .select('id, name, tiny_token')
      .not('tiny_token', 'is', null);

    if (!stores?.length) throw new Error('Nenhuma loja com tiny_token');

    const perStore: any[] = [];

    for (const store of stores) {
      const token = store.tiny_token;
      let page = 1;
      let pairs = 0;        // soma de estoque (apenas > 0)
      let costTotal = 0;    // SUM(stock * preco_custo)
      let saleTotal = 0;    // SUM(stock * preco)
      let skuCount = 0;     // SKUs com estoque > 0
      let skuAll = 0;       // total de SKUs retornados
      let withoutCost = 0;  // SKUs com estoque > 0 mas sem custo
      let lastError: string | null = null;

      while (page <= maxPagesPerStore) {
        const resp = await fetch('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&pagina=${page}`,
        });
        const data = await resp.json().catch(() => ({}));

        const status = data?.retorno?.status;
        if (status === 'Erro') {
          lastError = JSON.stringify(data?.retorno?.erros || data?.retorno);
          break;
        }

        const produtos = data?.retorno?.produtos || [];
        if (!produtos.length) break;

        for (const wrapper of produtos) {
          const p = wrapper.produto || wrapper;
          skuAll += 1;
          const stock = parseFloat(p.estoque ?? p.saldo ?? '0') || 0;
          const cost = parseFloat(p.preco_custo ?? '0') || 0;
          const price = parseFloat(p.preco ?? '0') || 0;

          if (stock > 0) {
            skuCount += 1;
            pairs += stock;
            costTotal += stock * cost;
            saleTotal += stock * price;
            if (cost <= 0) withoutCost += 1;
          }
        }

        const totalPages = parseInt(data?.retorno?.numero_paginas ?? '1', 10) || 1;
        if (page >= totalPages) break;
        page += 1;

        // throttle: ~30 req/min = 1 req a cada 2s. Usamos 2.2s pra margem.
        await sleep(2200);
      }

      perStore.push({
        store_id: store.id,
        store_name: store.name,
        pages_scanned: page,
        skus_total: skuAll,
        skus_with_stock: skuCount,
        pairs_in_stock: pairs,
        cost_total: Number(costTotal.toFixed(2)),
        sale_total: Number(saleTotal.toFixed(2)),
        avg_cost_per_pair: pairs > 0 ? Number((costTotal / pairs).toFixed(2)) : 0,
        avg_sale_per_pair: pairs > 0 ? Number((saleTotal / pairs).toFixed(2)) : 0,
        skus_with_stock_but_no_cost: withoutCost,
        last_error: lastError,
      });
    }

    const totals = perStore.reduce(
      (acc, s) => ({
        pairs_in_stock: acc.pairs_in_stock + s.pairs_in_stock,
        cost_total: acc.cost_total + s.cost_total,
        sale_total: acc.sale_total + s.sale_total,
        skus_with_stock: acc.skus_with_stock + s.skus_with_stock,
        skus_total: acc.skus_total + s.skus_total,
      }),
      { pairs_in_stock: 0, cost_total: 0, sale_total: 0, skus_with_stock: 0, skus_total: 0 }
    );

    return new Response(
      JSON.stringify({
        per_store: perStore,
        totals: {
          ...totals,
          cost_total: Number(totals.cost_total.toFixed(2)),
          sale_total: Number(totals.sale_total.toFixed(2)),
        },
        note: 'Dados extraídos via produtos.pesquisa.php (API v2 Tiny). Tiny replica produto entre contas, então o total empresa pode ter sobreposição se o mesmo SKU aparecer em mais de uma conta com estoque positivo.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
