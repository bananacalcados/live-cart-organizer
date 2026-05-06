// Discovery: agrupa pos_products por GTIN único entre todas as lojas ativas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isValidGtin(s: string | null | undefined): boolean {
  if (!s) return false;
  const d = s.replace(/\D/g, "");
  return d.length === 13;
}

function normName(n: string | null | undefined) {
  return (n || "").trim().toLowerCase().replace(/\s+/g, " ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const mode: "dry_run" | "persist" = body?.mode === "persist" ? "persist" : "dry_run";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth: require admin
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

    // Run record
    const { data: run } = await supabase.from("tiny_import_runs").insert({
      run_type: "discovery", dry_run: mode === "dry_run", status: "running"
    }).select("id").single();

    // Fetch active stores
    const { data: stores } = await supabase
      .from("pos_stores").select("id").eq("is_active", true);
    const storeIds = (stores || []).map((s: any) => s.id);

    if (storeIds.length === 0) {
      return new Response(JSON.stringify({ error: "no active stores" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Page through pos_products
    const PAGE = 1000;
    let from = 0;
    let totalRead = 0;
    const byGtin = new Map<string, { name: string; category: string | null; rep: string; stores: Set<string>; tinyIds: Record<string, number> }>();
    const byNameSku = new Map<string, { name: string; category: string | null; rep: string; stores: Set<string>; tinyIds: Record<string, number> }>();
    let ignored = 0;

    while (true) {
      const { data, error } = await supabase
        .from("pos_products")
        .select("id, store_id, tiny_id, sku, name, category, barcode, is_active")
        .eq("is_active", true)
        .in("store_id", storeIds)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      totalRead += data.length;

      for (const p of data) {
        if (isValidGtin(p.barcode)) {
          const key = p.barcode!.replace(/\D/g, "");
          let entry = byGtin.get(key);
          if (!entry) { entry = { name: p.name, category: p.category, rep: p.id, stores: new Set(), tinyIds: {} }; byGtin.set(key, entry); }
          entry.stores.add(p.store_id);
          if (p.tiny_id) entry.tinyIds[p.store_id] = Number(p.tiny_id);
        } else if (p.name && p.sku) {
          const key = `${normName(p.name)}|${(p.sku || "").trim().toLowerCase()}`;
          let entry = byNameSku.get(key);
          if (!entry) { entry = { name: p.name, category: p.category, rep: p.id, stores: new Set(), tinyIds: {} }; byNameSku.set(key, entry); }
          entry.stores.add(p.store_id);
          if (p.tiny_id) entry.tinyIds[p.store_id] = Number(p.tiny_id);
        } else {
          ignored++;
        }
      }

      if (data.length < PAGE) break;
      from += PAGE;
    }

    const stats = {
      total_pos_products: totalRead,
      unique_gtins: byGtin.size,
      fallback_name_sku: byNameSku.size,
      ignored_no_name_or_barcode: ignored,
      stores_active: storeIds.length,
    };

    let persisted = 0;
    if (mode === "persist") {
      const rows: any[] = [];
      for (const [key, e] of byGtin.entries()) {
        rows.push({
          dedupe_key: key, dedupe_method: "gtin",
          representative_pos_product_id: e.rep,
          representative_name: e.name, representative_category: e.category,
          stores_present: Array.from(e.stores),
          tiny_ids_per_store: e.tinyIds,
          validation_status: "pending",
        });
      }
      for (const [key, e] of byNameSku.entries()) {
        rows.push({
          dedupe_key: key, dedupe_method: "fallback_name_sku",
          representative_pos_product_id: e.rep,
          representative_name: e.name, representative_category: e.category,
          stores_present: Array.from(e.stores),
          tiny_ids_per_store: e.tinyIds,
          validation_status: "pending",
        });
      }
      // upsert in batches
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const { error } = await supabase
          .from("product_dedup_index")
          .upsert(slice, { onConflict: "dedupe_key,dedupe_method", ignoreDuplicates: false });
        if (error) throw error;
        persisted += slice.length;
      }
    }

    await supabase.from("tiny_import_runs").update({
      finished_at: new Date().toISOString(),
      total_processed: totalRead,
      success_count: persisted,
      status: "completed",
      stats,
    }).eq("id", run!.id);

    return new Response(JSON.stringify({ run_id: run!.id, mode, stats, persisted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
