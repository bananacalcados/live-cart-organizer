import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATALOG_PAGES_PER_CHUNK = 5;
const STOCK_SKUS_PER_CHUNK = 25;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const num = (value: unknown) => {
  const parsed = parseFloat(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const edgeRuntime = (globalThis as typeof globalThis & {
  EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
}).EdgeRuntime;

type StoreCfg = {
  id: string;
  name: string;
  tiny_token: string;
  tiny_deposit_name: string | null;
};

type AuditOptions = {
  runId: string;
  stage?: 1 | 2 | null;
  storeIds?: string[] | null;
  updateOnly: boolean;
};

type RunRow = {
  id: string;
  status: string;
  per_store: any[] | null;
  totals: Record<string, unknown> | null;
  error_message: string | null;
};

async function tinyPost(url: string, body: string, attempt = 0): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("tiny_timeout"), 20000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (data?.retorno?.codigo_erro === "6" && attempt < 4) {
      await sleep(15000 + attempt * 5000);
      return tinyPost(url, body, attempt + 1);
    }

    if (!response.ok && attempt < 2) {
      await sleep(4000 + attempt * 2000);
      return tinyPost(url, body, attempt + 1);
    }

    return data;
  } catch (error: any) {
    const isAbort = error?.name === "AbortError" || String(error?.message || "").includes("tiny_timeout");
    if ((isAbort || attempt < 2) && attempt < 3) {
      await sleep(4000 + attempt * 2000);
      return tinyPost(url, body, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapPerStore(perStore: any[] | null | undefined) {
  const map: Record<string, any> = {};
  for (const item of perStore || []) {
    if (item?.store_id) map[item.store_id] = item;
  }
  return map;
}

function catalogDone(state: any) {
  return Boolean(state?.catalog_finished || (state?.stage === 1 && state?.finished === true));
}

function stockDone(state: any) {
  return Boolean(state?.stock_finished || (state?.stage === 2 && state?.finished === true));
}

async function updateRunProgress(supabase: any, runId: string, perStoreState: Record<string, any>) {
  await supabase
    .from("inventory_audit_runs")
    .update({ per_store: Object.values(perStoreState) })
    .eq("id", runId);
}

async function checkpointRunProgress(
  supabase: any,
  runId: string,
  perStoreState: Record<string, any>,
  storeId: string,
  stats: Record<string, any>,
) {
  perStoreState[storeId] = {
    ...stats,
    last_progress_at: new Date().toISOString(),
  };
  await updateRunProgress(supabase, runId, perStoreState);
}

async function enqueueContinuation(options: AuditOptions) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  await fetch(`${supabaseUrl}/functions/v1/inventory-audit-tiny`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      run_id: options.runId,
      stage: options.stage ?? null,
      store_ids: options.storeIds ?? null,
      update_only: options.updateOnly,
    }),
  });
}

async function loadStores(supabase: any, storeIds?: string[] | null): Promise<StoreCfg[]> {
  let query = supabase
    .from("pos_stores")
    .select("id, name, tiny_token, tiny_deposit_name")
    .not("tiny_token", "is", null)
    .eq("is_active", true)
    .eq("is_simulation", false)
    .order("name");

  if (storeIds?.length) {
    query = query.in("id", storeIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as StoreCfg[];
}

async function syncCatalogChunk(
  supabase: any,
  store: StoreCfg,
  runId: string,
  perStoreState: Record<string, any>,
  updateOnly: boolean,
) {
  const previous = perStoreState[store.id] || {};
  const stats = {
    store_id: store.id,
    store_name: store.name,
    stage: 1,
    pages_scanned: Number(previous.pages_scanned) || 0,
    skus_seen: Number(previous.skus_seen) || 0,
    skus_upserted: Number(previous.skus_upserted) || 0,
    skus_inserted: Number(previous.skus_inserted) || 0,
    skus_updated: Number(previous.skus_updated) || 0,
    cost_total_listed: Number(previous.cost_total_listed) || 0,
    sale_total_listed: Number(previous.sale_total_listed) || 0,
    total_pages: Number(previous.total_pages) || null,
    last_error: null as string | null,
    finished: false,
    catalog_finished: false,
  };

  const startPage = stats.pages_scanned + 1;
  const endPage = startPage + CATALOG_PAGES_PER_CHUNK - 1;
  let done = false;

  for (let page = startPage; page <= endPage; page += 1) {
    const data = await tinyPost(
      "https://api.tiny.com.br/api2/produtos.pesquisa.php",
      `token=${store.tiny_token}&formato=json&pagina=${page}`,
    );

    if (data?.retorno?.status === "Erro") {
      throw new Error(`${store.name}: erro no catálogo ${JSON.stringify(data?.retorno?.erros || data?.retorno)}`);
    }

    const produtos = data?.retorno?.produtos || [];
    const totalPages = parseInt(String(data?.retorno?.numero_paginas ?? "1"), 10) || 1;
    stats.total_pages = totalPages;

    if (!produtos.length) {
      done = true;
      break;
    }

    const rows: any[] = [];
    for (const wrapper of produtos) {
      const product = wrapper.produto || wrapper;
      const tinyId = product.id ? Number(product.id) : null;
      if (!tinyId) continue;

      const cost = num(product.preco_custo) || num(product.preco_custo_medio);
      const price = num(product.preco);

      stats.skus_seen += 1;
      stats.cost_total_listed += cost;
      stats.sale_total_listed += price;

      rows.push({
        tiny_id: tinyId,
        sku: String(product.codigo ?? product.gtin ?? tinyId).trim() || String(tinyId),
        name: String(product.nome ?? "").slice(0, 500),
        variant: String(product.variacao ?? "").slice(0, 200),
        category: product.categoria ? String(product.categoria).slice(0, 200) : null,
        price,
        cost_price: cost,
        barcode: String(product.gtin ?? "").slice(0, 30),
      });
    }

    if (rows.length > 0) {
      const tinyIds = rows.map((row) => row.tiny_id);
      const { data: existing, error: existingError } = await supabase
        .from("pos_products")
        .select("id, tiny_id")
        .eq("store_id", store.id)
        .in("tiny_id", tinyIds);

      if (existingError) throw existingError;

      const existingMap = new Map<number, string>();
      for (const item of existing || []) {
        if (!existingMap.has(Number((item as any).tiny_id))) {
          existingMap.set(Number((item as any).tiny_id), (item as any).id);
        }
      }

      const toInsert: any[] = [];
      const toUpdate: Array<{ id: string; patch: Record<string, unknown> }> = [];

      for (const row of rows) {
        const existingId = existingMap.get(row.tiny_id);
        if (existingId) {
          toUpdate.push({
            id: existingId,
            patch: {
              name: row.name,
              category: row.category,
              price: row.price,
              cost_price: row.cost_price,
              barcode: row.barcode,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          });
        } else if (!updateOnly) {
          toInsert.push({
            store_id: store.id,
            tiny_id: row.tiny_id,
            sku: row.sku,
            name: row.name,
            variant: row.variant,
            category: row.category,
            price: row.price,
            cost_price: row.cost_price,
            barcode: row.barcode,
            stock: 0,
            is_active: true,
            synced_at: new Date().toISOString(),
          });
        }
      }

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase.from("pos_products").insert(toInsert);
        if (insertError) throw insertError;
        stats.skus_inserted += toInsert.length;
      }

      if (toUpdate.length > 0) {
        const results = await Promise.all(
          toUpdate.map(({ id, patch }) => supabase.from("pos_products").update(patch).eq("id", id)),
        );
        const failed = results.find((result: any) => result.error);
        if (failed?.error) throw failed.error;
        stats.skus_updated += toUpdate.length;
      }

      stats.skus_upserted += toInsert.length + toUpdate.length;
    }

    stats.pages_scanned = page;
    if (page >= totalPages) {
      done = true;
      break;
    }

    await sleep(2200);
  }

  stats.finished = done;
  stats.catalog_finished = done;
  perStoreState[store.id] = stats;
  await updateRunProgress(supabase, runId, perStoreState);

  return { done, stats };
}

async function syncStockChunk(
  supabase: any,
  store: StoreCfg,
  runId: string,
  perStoreState: Record<string, any>,
) {
  const previous = perStoreState[store.id] || {};
  const stats: any = {
    ...previous,
    store_id: store.id,
    store_name: store.name,
    stage: 2,
    stock_skus_processed: Number(previous.stock_skus_processed) || 0,
    pairs_in_stock: Number(previous.pairs_in_stock) || 0,
    cost_total_in_stock: Number(previous.cost_total_in_stock) || 0,
    sale_total_in_stock: Number(previous.sale_total_in_stock) || 0,
    skus_with_stock: Number(previous.skus_with_stock) || 0,
    skus_with_stock_no_cost: Number(previous.skus_with_stock_no_cost) || 0,
    stage2_started_at: previous.stage2_started_at || new Date().toISOString(),
    finished: false,
    stock_finished: false,
    last_error: previous.last_error || null,
  };

  const offset = stats.stock_skus_processed;
  const depositName = (store.tiny_deposit_name || "").toLowerCase();
  const { data: products, error } = await supabase
    .from("pos_products")
    .select("id, tiny_id, cost_price, price")
    .eq("store_id", store.id)
    .not("tiny_id", "is", null)
    .order("id")
    .range(offset, offset + STOCK_SKUS_PER_CHUNK - 1);

  if (error) throw error;

  const batch = (products || []) as Array<{ id: string; tiny_id: number; cost_price: number | null; price: number | null }>;

  if (batch.length === 0) {
    stats.finished = true;
    stats.stock_finished = true;
    await checkpointRunProgress(supabase, runId, perStoreState, store.id, stats);
    return { done: true, stats };
  }

  for (const product of batch) {
    let stock = 0;

    try {
      const data = await tinyPost(
        "https://api.tiny.com.br/api2/produto.obter.estoque.php",
        `token=${store.tiny_token}&formato=json&id=${product.tiny_id}`,
      );

      if (data?.retorno?.status !== "Erro") {
        const tinyProduct = data?.retorno?.produto;
        const deposits = tinyProduct?.depositos || [];
        stock = num(tinyProduct?.saldo);

        if (depositName && deposits.length > 0) {
          const matched = deposits.find((entry: any) => {
            const deposit = entry?.deposito || entry;
            const name = String(deposit?.nome || deposit?.descricao || "").toLowerCase();
            return name === depositName;
          });

          if (matched) {
            const deposit = matched?.deposito || matched;
            stock = num(deposit?.saldo);
          }
        }
      }
    } catch (fetchError: any) {
      stats.last_error = `stock fetch ${product.tiny_id}: ${fetchError.message}`;
    }

    const { error: updateError } = await supabase
      .from("pos_products")
      .update({ stock, synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", product.id);

    if (updateError) throw updateError;

    stats.stock_skus_processed += 1;
    if (stock > 0) {
      stats.skus_with_stock += 1;
      stats.pairs_in_stock += stock;
      const cost = Number(product.cost_price) || 0;
      const price = Number(product.price) || 0;
      stats.cost_total_in_stock += stock * cost;
      stats.sale_total_in_stock += stock * price;
      if (cost <= 0) stats.skus_with_stock_no_cost += 1;
    }

    stats.cost_total_in_stock = Number(stats.cost_total_in_stock.toFixed(2));
    stats.sale_total_in_stock = Number(stats.sale_total_in_stock.toFixed(2));
    await checkpointRunProgress(supabase, runId, perStoreState, store.id, stats);

    await sleep(2100);
  }

  const done = batch.length < STOCK_SKUS_PER_CHUNK;
  stats.finished = done;
  stats.stock_finished = done;
  stats.cost_total_in_stock = Number(stats.cost_total_in_stock.toFixed(2));
  stats.sale_total_in_stock = Number(stats.sale_total_in_stock.toFixed(2));
  await checkpointRunProgress(supabase, runId, perStoreState, store.id, stats);

  return { done, stats };
}

async function markRunDone(supabase: any, runId: string, perStoreState: Record<string, any>) {
  const perStore = Object.values(perStoreState) as any[];
  const totals = perStore.reduce(
    (acc, store) => ({
      pairs_in_stock: acc.pairs_in_stock + (store.pairs_in_stock || 0),
      cost_total_in_stock: acc.cost_total_in_stock + (store.cost_total_in_stock || 0),
      sale_total_in_stock: acc.sale_total_in_stock + (store.sale_total_in_stock || 0),
      skus_with_stock: acc.skus_with_stock + (store.skus_with_stock || 0),
      skus_seen: acc.skus_seen + (store.skus_seen || 0),
      skus_inserted: acc.skus_inserted + (store.skus_inserted || 0),
      skus_updated: acc.skus_updated + (store.skus_updated || 0),
      stock_skus_processed: acc.stock_skus_processed + (store.stock_skus_processed || 0),
    }),
    {
      pairs_in_stock: 0,
      cost_total_in_stock: 0,
      sale_total_in_stock: 0,
      skus_with_stock: 0,
      skus_seen: 0,
      skus_inserted: 0,
      skus_updated: 0,
      stock_skus_processed: 0,
    },
  );

  await supabase
    .from("inventory_audit_runs")
    .update({
      status: "done",
      per_store: perStore,
      totals: {
        ...totals,
        cost_total_in_stock: Number(totals.cost_total_in_stock.toFixed(2)),
        sale_total_in_stock: Number(totals.sale_total_in_stock.toFixed(2)),
      },
      finished_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", runId);
}

async function processNextChunk(supabase: any, options: AuditOptions) {
  const { data: run, error: runError } = await supabase
    .from("inventory_audit_runs")
    .select("id, status, per_store, totals, error_message")
    .eq("id", options.runId)
    .maybeSingle();

  if (runError) throw runError;
  if (!run) throw new Error("Auditoria não encontrada");
  if (run.status === "done") return;

  const stores = await loadStores(supabase, options.storeIds);
  if (stores.length === 0) throw new Error("Nenhuma loja com Tiny configurado");

  const perStoreState = mapPerStore((run as RunRow).per_store);

  if (options.stage !== 2) {
    const nextCatalogStore = stores.find((store) => !catalogDone(perStoreState[store.id]));
    if (nextCatalogStore) {
      const result = await syncCatalogChunk(supabase, nextCatalogStore, options.runId, perStoreState, options.updateOnly);
      if (!result.done || stores.some((store) => !catalogDone(perStoreState[store.id]))) {
        await enqueueContinuation(options);
        return;
      }
      if (options.stage === 1) {
        await markRunDone(supabase, options.runId, perStoreState);
        return;
      }
    }
  }

  if (options.stage !== 1) {
    const nextStockStore = stores.find((store) => !stockDone(perStoreState[store.id]));
    if (nextStockStore) {
      const result = await syncStockChunk(supabase, nextStockStore, options.runId, perStoreState);
      if (!result.done || stores.some((store) => !stockDone(perStoreState[store.id]))) {
        await enqueueContinuation(options);
        return;
      }
    }
  }

  await markRunDone(supabase, options.runId, perStoreState);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const runId = url.searchParams.get("run_id");
      const query = supabase.from("inventory_audit_runs").select("*");
      const { data, error } = runId
        ? await query.eq("id", runId).maybeSingle()
        : await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (error) throw error;

      return new Response(JSON.stringify(data || {}), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const existingRunId = typeof body.run_id === "string" ? body.run_id : null;
    const stage: 1 | 2 | null = body.stage === 1 || body.stage === 2 ? body.stage : null;
    const storeIds: string[] | null = Array.isArray(body.store_ids) ? body.store_ids : null;
    const updateOnly = body.update_only !== false;

    let runId = existingRunId;

    if (!runId) {
      const { data: createdRun, error } = await supabase
        .from("inventory_audit_runs")
        .insert({ status: "running", per_store: [], totals: {}, error_message: null })
        .select("id")
        .single();

      if (error) throw error;
      runId = createdRun.id;
    } else {
      const { data: existingRun, error } = await supabase
        .from("inventory_audit_runs")
        .select("id, status, finished_at")
        .eq("id", runId)
        .maybeSingle();

      if (error) throw error;
      if (!existingRun) throw new Error("Auditoria não encontrada");
      if (existingRun.status === "done") {
        return new Response(JSON.stringify({
          run_id: runId,
          status: "done",
          message: "Essa auditoria já foi finalizada.",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase
        .from("inventory_audit_runs")
        .update({ status: "running", error_message: null, finished_at: null })
        .eq("id", runId);
    }

    const options: AuditOptions = { runId, stage, storeIds, updateOnly };
    const job = processNextChunk(supabase, options).catch(async (error: any) => {
      await supabase
        .from("inventory_audit_runs")
        .update({
          status: "error",
          error_message: error.message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    });

    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(job);
    } else {
      job.catch(() => undefined);
    }

    return new Response(JSON.stringify({
      run_id: runId,
      status: "running",
      update_only: updateOnly,
      message: existingRunId
        ? `Continuação da auditoria ${runId} enfileirada.`
        : `Auditoria v2 iniciada (stage=${stage ?? "all"}, update_only=${updateOnly}).`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
