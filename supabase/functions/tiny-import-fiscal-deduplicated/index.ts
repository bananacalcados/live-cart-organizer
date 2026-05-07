// Importação Fiscal Deduplicada — busca dados fiscais no Tiny e popula products_master + product_variants
// VERSÃO PARALELA: processa N produtos em paralelo, distribuindo entre tokens de lojas distintas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractVariant(name: string): { baseName: string; size: string | null; color: string | null } {
  const parts = (name || "").split(" - ").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const baseName = parts.slice(0, -2).join(" - ");
    const size = parts[parts.length - 2] || null;
    const color = parts[parts.length - 1] || null;
    return { baseName, size, color };
  }
  if (parts.length === 2) {
    const last = parts[1];
    if (/^\d{2,3}$/.test(last)) return { baseName: parts[0], size: last, color: null };
    return { baseName: parts[0], size: null, color: last };
  }
  return { baseName: name || "PRODUTO SEM NOME", size: null, color: null };
}

function slugifySku(name: string): string {
  return (name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 60) || "PROD";
}

function num(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function fetchTinyProduct(token: string, tinyId: number): Promise<any> {
  const resp = await fetch("https://api.tiny.com.br/api2/produto.obter.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `token=${token}&formato=json&id=${tinyId}`,
  });
  return (await resp.json())?.retorno;
}

// Pool de concorrência simples
async function pMap<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { results[idx] = await fn(items[idx], idx); } catch (e) { results[idx] = e as any; }
    }
  });
  await Promise.all(workers);
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const mode: "dry_run" | "persist" = body?.mode === "persist" ? "persist" : "dry_run";
    const limit: number = Math.min(Math.max(Number(body?.limit) || 200, 1), 1000);
    const concurrency: number = Math.min(Math.max(Number(body?.concurrency) || 12, 1), 30);
    const onlyMethod: string | null = body?.only_method || null;
    const skipImported: boolean = body?.skip_imported !== false;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth admin
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: run } = await supabase.from("tiny_import_runs").insert({
      run_type: "import", dry_run: mode === "dry_run", status: "running",
      stats: { limit, concurrency, only_method: onlyMethod, skip_imported: skipImported },
    }).select("id").single();
    const runId = run!.id;

    // Load store tokens
    const { data: stores } = await supabase
      .from("pos_stores").select("id, name, tiny_token").eq("is_active", true).not("tiny_token", "is", null);
    const tokenByStore = new Map<string, string>();
    for (const s of stores || []) tokenByStore.set(s.id, s.tiny_token);

    // Pull batch
    let q = supabase.from("product_dedup_index").select("*").limit(limit);
    if (skipImported) q = q.is("imported_at", null);
    if (onlyMethod) q = q.eq("dedupe_method", onlyMethod);
    q = q.order("created_at", { ascending: true });
    const { data: dedupRows, error: dedupErr } = await q;
    if (dedupErr) throw dedupErr;

    const stats = {
      processed: 0, tiny_ok: 0, tiny_error: 0,
      masters_upserted: 0, variants_upserted: 0,
      with_ncm: 0, with_gtin: 0, skipped_no_tiny_id: 0,
    };
    const masterCache = new Map<string, string>(); // sku_root -> master_id
    const masterLocks = new Map<string, Promise<string | null>>(); // evita corrida criar 2x mesmo master

    async function getOrCreateMaster(sku_root: string, payload: any): Promise<string | null> {
      const cached = masterCache.get(sku_root);
      if (cached) {
        // update fiscal fields async (non-blocking ish)
        await supabase.from("products_master").update(payload.update).eq("id", cached);
        return cached;
      }
      if (masterLocks.has(sku_root)) return await masterLocks.get(sku_root)!;
      const p = (async () => {
        const { data: existing } = await supabase
          .from("products_master").select("id").eq("sku_root", sku_root).maybeSingle();
        if (existing) {
          await supabase.from("products_master").update(payload.update).eq("id", existing.id);
          masterCache.set(sku_root, existing.id);
          return existing.id;
        }
        const { data: ins, error: insErr } = await supabase.from("products_master")
          .insert(payload.insert).select("id").single();
        if (insErr || !ins) {
          await supabase.from("tiny_import_errors").insert({
            run_id: runId, error_code: "master_insert_fail", error_message: insErr?.message || "no id",
          });
          return null;
        }
        masterCache.set(sku_root, ins.id);
        stats.masters_upserted++;
        return ins.id;
      })();
      masterLocks.set(sku_root, p);
      return await p;
    }

    await pMap(dedupRows || [], concurrency, async (row: any) => {
      stats.processed++;

      const tinyIds = (row.tiny_ids_per_store || {}) as Record<string, number>;
      const candidateStores = (row.stores_present || []).filter((sid: string) => tinyIds[sid] && tokenByStore.has(sid));
      if (candidateStores.length === 0) {
        stats.skipped_no_tiny_id++;
        if (mode === "persist") {
          await supabase.from("product_dedup_index").update({
            imported_at: new Date().toISOString(),
            validation_status: "no_tiny_id",
          }).eq("id", row.id);
        }
        return;
      }
      const storeId = candidateStores[0];
      const tinyId = tinyIds[storeId];
      const token = tokenByStore.get(storeId)!;

      let retorno: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          retorno = await fetchTinyProduct(token, tinyId);
          if (retorno?.status === "OK") break;
          const errMsg = retorno?.erros?.[0]?.erro || retorno?.status_processamento || "tiny_error";
          if (attempt === 0 && /limit|excedido|429/i.test(String(errMsg))) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          await supabase.from("tiny_import_errors").insert({
            run_id: runId, dedup_index_id: row.id,
            error_code: "tiny_error", error_message: String(errMsg).slice(0, 500),
          });
          retorno = null; break;
        } catch (e: any) {
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 1000)); continue; }
          await supabase.from("tiny_import_errors").insert({
            run_id: runId, dedup_index_id: row.id,
            error_code: "fetch_exception", error_message: String(e?.message || e).slice(0, 500),
          });
        }
      }

      if (!retorno || retorno.status !== "OK") {
        stats.tiny_error++;
        if (mode === "persist") {
          await supabase.from("product_dedup_index").update({
            imported_at: new Date().toISOString(),
            validation_status: "tiny_error",
          }).eq("id", row.id);
        }
        return;
      }
      stats.tiny_ok++;

      const p = retorno.produto || {};
      const nameInfo = extractVariant(p.nome || row.representative_name || "");
      const sku_root = slugifySku(nameInfo.baseName);
      const ncm = p.ncm || null;
      const cest = p.cest || null;
      const origem = p.origem != null ? String(p.origem) : null;
      const unidade = p.unidade || "PC";
      const classe = p.classe_produto || null;
      const cost = num(p.preco_custo) ?? num(p.preco_custo_medio);
      const sale = num(p.preco) ?? num(p.preco_promocional);
      const weight = num(p.peso_bruto) ?? num(p.peso_liquido);
      const height = num(p.altura_embalagem);
      const width = num(p.largura_embalagem);
      const length_cm = num(p.comprimento_embalagem);
      const brand = p.marca || null;
      const category = p.categoria || row.representative_category || null;
      const variantGtin = (row.dedupe_method === "gtin") ? row.dedupe_key : (p.gtin || null);

      if (ncm) stats.with_ncm++;
      if (variantGtin && /^\d{13}$/.test(variantGtin)) stats.with_gtin++;

      if (mode === "dry_run") return;

      const masterPayload = {
        update: {
          ncm: ncm ?? undefined, cest: cest ?? undefined, origem: origem ?? undefined,
          unidade: unidade ?? undefined, classe_produto: classe ?? undefined,
          brand: brand ?? undefined, category: category ?? undefined,
          weight_kg: weight ?? undefined, height_cm: height ?? undefined,
          width_cm: width ?? undefined, length_cm: length_cm ?? undefined,
          cost_price: cost ?? undefined, sale_price: sale ?? undefined,
          tiny_product_id: String(tinyId), tiny_imported_at: new Date().toISOString(),
          tiny_source_store_id: storeId,
          needs_review: !ncm, review_reason: !ncm ? "NCM ausente no Tiny" : null,
        },
        insert: {
          sku_root, name: nameInfo.baseName,
          brand, category, ncm, cest, origem, unidade,
          classe_produto: classe,
          cost_price: cost, sale_price: sale,
          weight_kg: weight, height_cm: height, width_cm: width, length_cm: length_cm,
          is_active: true,
          tiny_product_id: String(tinyId),
          tiny_imported_at: new Date().toISOString(),
          tiny_source_store_id: storeId,
          needs_review: !ncm,
          review_reason: !ncm ? "NCM ausente no Tiny" : null,
        },
      };

      const masterId = await getOrCreateMaster(sku_root, masterPayload);
      if (!masterId) return;

      const variantSku = (p.codigo || row.dedupe_key).toString().slice(0, 60);
      const variantPayload: any = {
        master_id: masterId, sku: variantSku,
        gtin: variantGtin && /^\d{13}$/.test(variantGtin) ? variantGtin : null,
        color: nameInfo.color, size: nameInfo.size,
        cost_price_override: cost, sale_price_override: sale,
        weight_kg_override: weight, is_active: true,
        tiny_variant_id: String(tinyId),
        tiny_imported_at: new Date().toISOString(),
      };

      const { data: existingVar } = await supabase
        .from("product_variants").select("id")
        .eq("master_id", masterId)
        .eq("color", nameInfo.color || "")
        .eq("size", nameInfo.size || "")
        .maybeSingle();

      if (existingVar) {
        const { error: upErr } = await supabase.from("product_variants").update(variantPayload).eq("id", existingVar.id);
        if (upErr) {
          await supabase.from("tiny_import_errors").insert({
            run_id: runId, dedup_index_id: row.id,
            error_code: "variant_update_fail", error_message: upErr.message,
          });
        } else stats.variants_upserted++;
      } else {
        const { error: vErr } = await supabase.from("product_variants").insert(variantPayload);
        if (vErr) {
          await supabase.from("tiny_import_errors").insert({
            run_id: runId, dedup_index_id: row.id,
            error_code: "variant_insert_fail", error_message: vErr.message,
          });
        } else stats.variants_upserted++;
      }

      await supabase.from("product_dedup_index").update({
        imported_at: new Date().toISOString(),
      }).eq("id", row.id);
    });

    await supabase.from("tiny_import_runs").update({
      finished_at: new Date().toISOString(),
      total_processed: stats.processed,
      success_count: stats.tiny_ok,
      failure_count: stats.tiny_error + stats.skipped_no_tiny_id,
      status: "completed",
      stats,
    }).eq("id", runId);

    return new Response(JSON.stringify({ run_id: runId, mode, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
