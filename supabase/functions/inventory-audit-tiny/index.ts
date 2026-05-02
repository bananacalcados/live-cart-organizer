// Auditoria + Sync do Tiny → pos_products (modo BACKGROUND)
//
// Estratégia v2 (otimizada):
//   Stage 1 — produtos.pesquisa.php (paginado, 100/req): puxa nome, SKU, custo, preço, categoria.
//             UPSERT em pos_products a cada página. ~5min/loja.
//   Stage 2 — produto.obter.estoque.php (1/req, throttled): puxa estoque por depósito.
//             UPDATE em pos_products.stock. ~10min/loja se SKUs > 1k.
//
// POST {}                  → dispara nova auditoria, retorna run_id imediatamente
// POST { stage: 1|2 }      → roda só um estágio (debug)
// POST { store_ids: [...]} → limita a lojas específicas
// GET ?run_id=...          → status/resultado
//
// Persistência: cada SKU lido vira/atualiza linha em pos_products. Se a função cair,
// o que já foi puxado fica salvo. Re-rodar não desperdiça trabalho.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '0').replace(',', '.'));
  return isFinite(n) ? n : 0;
};

type StoreCfg = {
  id: string;
  name: string;
  tiny_token: string;
  tiny_deposit_name: string | null;
};

async function tinyPost(url: string, body: string, attempt = 0): Promise<any> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json().catch(() => ({}));
  // Tiny rate-limit: status_processamento "2" = OK; erros vêm em retorno.erros
  if (data?.retorno?.codigo_erro === '6' && attempt < 4) {
    // Limite excedido — espera e tenta de novo
    await sleep(15000 + attempt * 5000);
    return tinyPost(url, body, attempt + 1);
  }
  return data;
}

async function updateRunProgress(supabase: any, runId: string, patch: Record<string, unknown>) {
  await supabase.from('inventory_audit_runs').update(patch).eq('id', runId);
}

// =================== STAGE 1: Catálogo + custo + preço ===================
async function syncCatalog(supabase: any, store: StoreCfg, runId: string, perStoreState: any, updateOnly = false) {
  const stats = {
    store_id: store.id,
    store_name: store.name,
    stage: 1,
    pages_scanned: 0,
    skus_seen: 0,
    skus_upserted: 0,
    skus_inserted: 0,
    skus_updated: 0,
    cost_total_listed: 0,
    sale_total_listed: 0,
    last_error: null as string | null,
    finished: false,
  };

  let page = 1;
  const maxPages = 500;

  while (page <= maxPages) {
    const data = await tinyPost(
      'https://api.tiny.com.br/api2/produtos.pesquisa.php',
      `token=${store.tiny_token}&formato=json&pagina=${page}`,
    );

    if (data?.retorno?.status === 'Erro') {
      stats.last_error = JSON.stringify(data?.retorno?.erros || data?.retorno);
      break;
    }

    const produtos = data?.retorno?.produtos || [];
    if (!produtos.length) break;

    // Monta linhas pra UPSERT
    const rows: any[] = [];
    for (const wrapper of produtos) {
      const p = wrapper.produto || wrapper;
      const tinyId = p.id ? Number(p.id) : null;
      if (!tinyId) continue;

      const cost = num(p.preco_custo) || num(p.preco_custo_medio);
      const price = num(p.preco);
      stats.skus_seen += 1;
      stats.cost_total_listed += cost;
      stats.sale_total_listed += price;

      rows.push({
        tiny_id: tinyId,
        sku: String(p.codigo ?? p.gtin ?? tinyId).trim() || String(tinyId),
        name: String(p.nome ?? '').slice(0, 500),
        variant: String(p.variacao ?? '').slice(0, 200),
        category: p.categoria ? String(p.categoria).slice(0, 200) : null,
        price,
        cost_price: cost,
        barcode: String(p.gtin ?? '').slice(0, 30),
      });
    }

    // Persiste página: lookup por (store_id, tiny_id) → update OR insert
    if (rows.length > 0) {
      const tinyIds = rows.map(r => r.tiny_id);
      const { data: existing } = await supabase
        .from('pos_products')
        .select('id, tiny_id')
        .eq('store_id', store.id)
        .in('tiny_id', tinyIds);

      const existingMap = new Map<number, string>();
      (existing || []).forEach((e: any) => {
        // pode haver duplicatas legacy — pega a primeira
        if (!existingMap.has(Number(e.tiny_id))) existingMap.set(Number(e.tiny_id), e.id);
      });

      const toInsert: any[] = [];
      const toUpdate: { id: string; patch: any }[] = [];

      for (const r of rows) {
        const existingId = existingMap.get(r.tiny_id);
        if (existingId) {
          toUpdate.push({
            id: existingId,
            patch: {
              name: r.name,
              category: r.category,
              price: r.price,
              cost_price: r.cost_price,
              barcode: r.barcode,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          });
        } else {
          toInsert.push({
            store_id: store.id,
            tiny_id: r.tiny_id,
            sku: r.sku,
            name: r.name,
            variant: r.variant,
            category: r.category,
            price: r.price,
            cost_price: r.cost_price,
            barcode: r.barcode,
            stock: 0, // será preenchido no Stage 2
            is_active: true,
            synced_at: new Date().toISOString(),
          });
        }
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('pos_products').insert(toInsert);
        if (insErr) {
          stats.last_error = `insert: ${insErr.message}`;
        } else {
          stats.skus_inserted += toInsert.length;
        }
      }

      // Updates em paralelo (poucos por página)
      if (toUpdate.length > 0) {
        await Promise.all(
          toUpdate.map(({ id, patch }) =>
            supabase.from('pos_products').update(patch).eq('id', id),
          ),
        );
        stats.skus_updated += toUpdate.length;
      }

      stats.skus_upserted += toInsert.length + toUpdate.length;
    }

    stats.pages_scanned = page;
    const totalPages = parseInt(data?.retorno?.numero_paginas ?? '1', 10) || 1;

    // Persiste progresso a cada 5 páginas
    if (page % 5 === 0 || page >= totalPages) {
      perStoreState[store.id] = { ...stats };
      await updateRunProgress(supabase, runId, {
        per_store: Object.values(perStoreState),
      });
    }

    if (page >= totalPages) break;
    page += 1;
    await sleep(2200);
  }

  stats.finished = true;
  perStoreState[store.id] = { ...stats };
  await updateRunProgress(supabase, runId, { per_store: Object.values(perStoreState) });
  return stats;
}

// =================== STAGE 2: Estoque ===================
async function syncStock(supabase: any, store: StoreCfg, runId: string, perStoreState: any) {
  const stats: any = {
    ...(perStoreState[store.id] || { store_id: store.id, store_name: store.name }),
    stage: 2,
    stock_skus_processed: 0,
    pairs_in_stock: 0,
    cost_total_in_stock: 0,
    sale_total_in_stock: 0,
    skus_with_stock: 0,
    skus_with_stock_no_cost: 0,
    stage2_started_at: new Date().toISOString(),
    finished: false,
  };

  // Pega SKUs deste store que têm tiny_id
  const { data: products } = await supabase
    .from('pos_products')
    .select('id, tiny_id, cost_price, price')
    .eq('store_id', store.id)
    .not('tiny_id', 'is', null);

  const list = (products || []) as Array<{ id: string; tiny_id: number; cost_price: number | null; price: number | null }>;
  const total = list.length;
  const depName = (store.tiny_deposit_name || '').toLowerCase();

  for (let i = 0; i < total; i++) {
    const p = list[i];
    let stock = 0;
    try {
      const data = await tinyPost(
        'https://api.tiny.com.br/api2/produto.obter.estoque.php',
        `token=${store.tiny_token}&formato=json&id=${p.tiny_id}`,
      );
      if (data?.retorno?.status !== 'Erro') {
        const produto = data?.retorno?.produto;
        const depositos = produto?.depositos || [];
        stock = num(produto?.saldo);
        if (depName && depositos.length > 0) {
          const matched = depositos.find((d: any) => {
            const dep = d?.deposito || d;
            const name = String(dep?.nome || dep?.descricao || '').toLowerCase();
            return name === depName;
          });
          if (matched) {
            const dep = matched?.deposito || matched;
            stock = num(dep?.saldo);
          }
        }
      }
    } catch (e: any) {
      stats.last_error = `stock fetch ${p.tiny_id}: ${e.message}`;
    }

    // Persiste estoque
    await supabase
      .from('pos_products')
      .update({ stock, synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', p.id);

    stats.stock_skus_processed = i + 1;
    if (stock > 0) {
      stats.skus_with_stock += 1;
      stats.pairs_in_stock += stock;
      const cost = Number(p.cost_price) || 0;
      const price = Number(p.price) || 0;
      stats.cost_total_in_stock += stock * cost;
      stats.sale_total_in_stock += stock * price;
      if (cost <= 0) stats.skus_with_stock_no_cost += 1;
    }

    // Atualiza progresso a cada 25 SKUs
    if ((i + 1) % 25 === 0 || i === total - 1) {
      stats.cost_total_in_stock = Number(stats.cost_total_in_stock.toFixed(2));
      stats.sale_total_in_stock = Number(stats.sale_total_in_stock.toFixed(2));
      perStoreState[store.id] = { ...stats };
      await updateRunProgress(supabase, runId, { per_store: Object.values(perStoreState) });
    }

    await sleep(2100);
  }

  stats.finished = true;
  stats.cost_total_in_stock = Number(stats.cost_total_in_stock.toFixed(2));
  stats.sale_total_in_stock = Number(stats.sale_total_in_stock.toFixed(2));
  perStoreState[store.id] = { ...stats };
  await updateRunProgress(supabase, runId, { per_store: Object.values(perStoreState) });
  return stats;
}

// =================== Orquestrador ===================
async function runAudit(
  runId: string,
  supabase: any,
  opts: { stage?: 1 | 2 | null; storeIds?: string[] | null },
) {
  try {
    let q = supabase.from('pos_stores').select('id, name, tiny_token, tiny_deposit_name').not('tiny_token', 'is', null);
    if (opts.storeIds?.length) q = q.in('id', opts.storeIds);
    const { data: stores } = await q;
    if (!stores?.length) throw new Error('Nenhuma loja com tiny_token');

    const perStoreState: Record<string, any> = {};

    // Stage 1 sequencial por loja (Tiny rate-limit é por token, então paralelizar entre tokens diferentes seria seguro,
    // mas pra simplicidade rodamos sequencial)
    if (!opts.stage || opts.stage === 1) {
      for (const s of stores) {
        await syncCatalog(supabase, s, runId, perStoreState);
      }
    }

    if (!opts.stage || opts.stage === 2) {
      for (const s of stores) {
        await syncStock(supabase, s, runId, perStoreState);
      }
    }

    // Totais finais
    const arr = Object.values(perStoreState) as any[];
    const totals = arr.reduce(
      (acc, s) => ({
        pairs_in_stock: acc.pairs_in_stock + (s.pairs_in_stock || 0),
        cost_total_in_stock: acc.cost_total_in_stock + (s.cost_total_in_stock || 0),
        sale_total_in_stock: acc.sale_total_in_stock + (s.sale_total_in_stock || 0),
        skus_with_stock: acc.skus_with_stock + (s.skus_with_stock || 0),
        skus_seen: acc.skus_seen + (s.skus_seen || 0),
        skus_inserted: acc.skus_inserted + (s.skus_inserted || 0),
        skus_updated: acc.skus_updated + (s.skus_updated || 0),
      }),
      {
        pairs_in_stock: 0, cost_total_in_stock: 0, sale_total_in_stock: 0,
        skus_with_stock: 0, skus_seen: 0, skus_inserted: 0, skus_updated: 0,
      },
    );

    await supabase
      .from('inventory_audit_runs')
      .update({
        status: 'done',
        per_store: arr,
        totals: {
          ...totals,
          cost_total_in_stock: Number(totals.cost_total_in_stock.toFixed(2)),
          sale_total_in_stock: Number(totals.sale_total_in_stock.toFixed(2)),
        },
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
  } catch (e: any) {
    await supabase
      .from('inventory_audit_runs')
      .update({
        status: 'error',
        error_message: e.message,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const runId = url.searchParams.get('run_id');
      const query = supabase.from('inventory_audit_runs').select('*');
      const { data } = runId
        ? await query.eq('id', runId).maybeSingle()
        : await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
      return new Response(JSON.stringify(data || {}), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const stage: 1 | 2 | null = body.stage === 1 || body.stage === 2 ? body.stage : null;
    const storeIds: string[] | null = Array.isArray(body.store_ids) ? body.store_ids : null;

    const { data: run, error } = await supabase
      .from('inventory_audit_runs')
      .insert({ status: 'running', per_store: [], totals: {} })
      .select('id')
      .single();
    if (error) throw error;

    // @ts-ignore — EdgeRuntime
    EdgeRuntime.waitUntil(runAudit(run.id, supabase, { stage, storeIds }));

    return new Response(
      JSON.stringify({
        run_id: run.id,
        status: 'running',
        message: `Auditoria v2 iniciada (stage=${stage ?? 'all'}). Use GET ?run_id=${run.id} para acompanhar.`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
