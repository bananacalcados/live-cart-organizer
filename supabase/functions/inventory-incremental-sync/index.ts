import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const edgeRuntime = (globalThis as any).EdgeRuntime;

type StoreCfg = {
  id: string;
  name: string;
  tiny_token: string;
  tiny_deposit_name: string | null;
};

async function tinyPost(url: string, body: string, attempt = 0): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 30000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (data?.retorno?.codigo_erro === "6" && attempt < 5) {
      await sleep(15000 + attempt * 5000);
      return tinyPost(url, body, attempt + 1);
    }
    if (!res.ok && attempt < 2) {
      await sleep(3000);
      return tinyPost(url, body, attempt + 1);
    }
    return data;
  } catch (err: any) {
    if (attempt < 2) {
      await sleep(3000);
      return tinyPost(url, body, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function formatBrDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function processStore(
  supabase: any,
  store: StoreCfg,
  sinceDate: string,
  runId: string,
): Promise<{
  store_id: string;
  store_name: string;
  pages: number;
  skus_seen: number;
  skus_updated: number;
  not_found: number;
  last_error: string | null;
}> {
  const stats = {
    store_id: store.id,
    store_name: store.name,
    pages: 0,
    skus_seen: 0,
    skus_updated: 0,
    not_found: 0,
    last_error: null as string | null,
  };

  const depositName = (store.tiny_deposit_name || "").toLowerCase();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    let data: any;
    try {
      data = await tinyPost(
        "https://api.tiny.com.br/api2/lista.atualizacoes.estoque.php",
        `token=${encodeURIComponent(store.tiny_token)}&formato=json&dataAlteracao=${encodeURIComponent(sinceDate)}&pagina=${page}`,
      );
    } catch (err: any) {
      stats.last_error = `page ${page}: ${err.message}`;
      break;
    }

    const ret = data?.retorno;
    if (ret?.status === "Erro") {
      stats.last_error = `page ${page}: ${JSON.stringify(ret?.erros || ret)}`;
      break;
    }

    totalPages = parseInt(String(ret?.numero_paginas ?? "1"), 10) || 1;
    const produtos = ret?.produtos || [];
    if (!produtos.length) break;

    // Coleta SKUs com saldo do depósito desta loja
    const updates: Array<{ tiny_id: number; stock: number }> = [];
    for (const w of produtos) {
      const p = w?.produto || w;
      const tinyId = p?.id ? Number(p.id) : null;
      if (!tinyId) continue;
      stats.skus_seen += 1;

      let stock = num(p?.saldo);
      const deps = p?.depositos || [];
      if (depositName && deps.length > 0) {
        const matched = deps.find((entry: any) => {
          const d = entry?.deposito || entry;
          return String(d?.nome || d?.descricao || "").toLowerCase() === depositName;
        });
        if (matched) {
          const d = matched?.deposito || matched;
          stock = num(d?.saldo);
        }
      }
      updates.push({ tiny_id: tinyId, stock });
    }

    if (updates.length > 0) {
      // Busca os pos_products existentes em massa
      const tinyIds = updates.map((u) => u.tiny_id);
      const { data: existing, error: existingErr } = await supabase
        .from("pos_products")
        .select("id, tiny_id")
        .eq("store_id", store.id)
        .in("tiny_id", tinyIds);

      if (existingErr) {
        stats.last_error = `lookup: ${existingErr.message}`;
        break;
      }

      const idMap = new Map<number, string>();
      for (const r of existing || []) {
        idMap.set(Number((r as any).tiny_id), (r as any).id);
      }

      const now = new Date().toISOString();
      const updateResults = await Promise.all(
        updates.map(({ tiny_id, stock }) => {
          const productId = idMap.get(tiny_id);
          if (!productId) {
            stats.not_found += 1;
            return null;
          }
          return supabase
            .from("pos_products")
            .update({ stock, synced_at: now, updated_at: now })
            .eq("id", productId);
        }),
      );

      for (const r of updateResults) {
        if (r && !r.error) stats.skus_updated += 1;
        else if (r?.error) stats.last_error = `update: ${r.error.message}`;
      }
    }

    stats.pages = page;

    // Checkpoint após cada página
    await supabase
      .from("inventory_incremental_runs")
      .update({ progress: { current_store: store.id, ...stats } })
      .eq("id", runId);

    page += 1;

    if (page <= totalPages) await sleep(2200); // respeitar rate limit Tiny
  }

  return stats;
}

async function runIncremental(supabase: any, runId: string, days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = formatBrDate(since);

  const { data: stores, error: storesErr } = await supabase
    .from("pos_stores")
    .select("id, name, tiny_token, tiny_deposit_name")
    .not("tiny_token", "is", null)
    .eq("is_active", true)
    .eq("is_simulation", false);

  if (storesErr) throw storesErr;
  const list = (stores || []) as StoreCfg[];
  if (list.length === 0) throw new Error("Nenhuma loja com Tiny configurado");

  // Processa lojas em PARALELO (cada uma com seu token = rate limit independente)
  const results = await Promise.all(
    list.map((s) => processStore(supabase, s, sinceDate, runId).catch((e) => ({
      store_id: s.id,
      store_name: s.name,
      pages: 0,
      skus_seen: 0,
      skus_updated: 0,
      not_found: 0,
      last_error: e.message,
    }))),
  );

  const totals = results.reduce(
    (acc, r) => ({
      skus_seen: acc.skus_seen + r.skus_seen,
      skus_updated: acc.skus_updated + r.skus_updated,
      not_found: acc.not_found + r.not_found,
    }),
    { skus_seen: 0, skus_updated: 0, not_found: 0 },
  );

  await supabase
    .from("inventory_incremental_runs")
    .update({
      status: "done",
      per_store: results,
      totals,
      since_date: sinceDate,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const runId = url.searchParams.get("run_id");
      const q = supabase.from("inventory_incremental_runs").select("*");
      const { data, error } = runId
        ? await q.eq("id", runId).maybeSingle()
        : await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify(data || {}), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const days = Math.max(1, Math.min(30, Number(body?.days) || 1));

    const { data: created, error } = await supabase
      .from("inventory_incremental_runs")
      .insert({ status: "running", days_window: days, progress: {}, per_store: [], totals: {} })
      .select("id")
      .single();

    if (error) throw error;
    const runId = created.id;

    const job = runIncremental(supabase, runId, days).catch(async (err: any) => {
      await supabase
        .from("inventory_incremental_runs")
        .update({
          status: "error",
          error_message: err.message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    });

    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(job);
    else job.catch(() => undefined);

    return new Response(
      JSON.stringify({
        run_id: runId,
        status: "running",
        days_window: days,
        message: `Sync incremental iniciado (últimos ${days} dia(s)).`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
