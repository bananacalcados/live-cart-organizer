// Cross-validation: compara dados fiscais do MESMO produto (mesmo dedupe_key) entre lojas Tiny diferentes
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIELDS_TO_COMPARE = ["ncm", "cest", "origem", "unidade", "gtin", "marca"] as const;

async function fetchTinyProduct(token: string, tinyId: number): Promise<any> {
  const resp = await fetch("https://api.tiny.com.br/api2/produto.obter.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `token=${token}&formato=json&id=${tinyId}`,
  });
  return (await resp.json())?.retorno;
}

function norm(v: any): string {
  if (v === undefined || v === null) return "";
  return String(v).trim().toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const mode: "dry_run" | "persist" = body?.mode === "persist" ? "persist" : "dry_run";
    const limit: number = Math.min(Math.max(Number(body?.limit) || 30, 1), 200);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
      run_type: "cross_validation", dry_run: mode === "dry_run", status: "running",
      stats: { limit },
    }).select("id").single();
    const runId = run!.id;

    const { data: stores } = await supabase
      .from("pos_stores").select("id, tiny_token").eq("is_active", true).not("tiny_token", "is", null);
    const tokenByStore = new Map<string, string>();
    for (const s of stores || []) tokenByStore.set(s.id, s.tiny_token);

    // Pega só rows que estão presentes em >=2 lojas E ainda não validadas
    const { data: rows } = await supabase
      .from("product_dedup_index")
      .select("*")
      .is("validation_status", null)
      .order("created_at", { ascending: true })
      .limit(limit * 3); // sobre-amostra; filtra abaixo

    const stats = {
      processed: 0,
      single_store: 0,
      consistent: 0,
      divergent: 0,
      divergences_written: 0,
      tiny_errors: 0,
    };

    let used = 0;
    for (const row of rows || []) {
      if (used >= limit) break;
      const tinyIds = (row.tiny_ids_per_store || {}) as Record<string, number>;
      const storeIds = Object.keys(tinyIds).filter((sid) => tokenByStore.has(sid));
      if (storeIds.length < 2) {
        stats.single_store++;
        if (mode === "persist") {
          await supabase.from("product_dedup_index").update({ validation_status: "consistent" }).eq("id", row.id);
        }
        continue;
      }
      used++;
      stats.processed++;

      const fetched: { storeId: string; data: any }[] = [];
      for (const sid of storeIds) {
        try {
          const r = await fetchTinyProduct(tokenByStore.get(sid)!, tinyIds[sid]);
          if (r?.status === "OK") fetched.push({ storeId: sid, data: r.produto || {} });
          else stats.tiny_errors++;
          await new Promise((r) => setTimeout(r, 380));
        } catch {
          stats.tiny_errors++;
        }
      }

      if (fetched.length < 2) continue;

      // Comparar par a par com o primeiro como base
      const base = fetched[0];
      const divergences: any[] = [];
      for (let i = 1; i < fetched.length; i++) {
        const other = fetched[i];
        for (const f of FIELDS_TO_COMPARE) {
          const a = norm(base.data[f]);
          const b = norm(other.data[f]);
          if (a !== b) {
            divergences.push({
              dedup_index_id: row.id,
              store_a_id: base.storeId,
              store_b_id: other.storeId,
              field_name: f,
              value_a: String(base.data[f] ?? ""),
              value_b: String(other.data[f] ?? ""),
            });
          }
        }
      }

      if (divergences.length === 0) {
        stats.consistent++;
        if (mode === "persist") {
          await supabase.from("product_dedup_index").update({ validation_status: "consistent" }).eq("id", row.id);
        }
      } else {
        stats.divergent++;
        if (mode === "persist") {
          await supabase.from("tiny_fiscal_divergences").insert(divergences);
          stats.divergences_written += divergences.length;
          await supabase.from("product_dedup_index").update({ validation_status: "divergent" }).eq("id", row.id);
        }
      }
    }

    await supabase.from("tiny_import_runs").update({
      finished_at: new Date().toISOString(),
      total_processed: stats.processed,
      success_count: stats.consistent + stats.divergent,
      failure_count: stats.tiny_errors,
      status: "completed",
      stats,
    }).eq("id", runId);

    return new Response(JSON.stringify({ run_id: runId, mode, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
