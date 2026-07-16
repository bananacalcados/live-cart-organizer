// Exclusão em massa de produtos do Catálogo Legacy e/ou Unificado, com cascata bidirecional.
// Input: { master_ids?: string[], parent_skus?: string[] }
// - Resolve pares (sku_root ↔ parent_sku) e apaga em cascata onde ambos existirem.
// - Bloqueia itens com histórico de venda em pos_sale_items (por sku ou parent_sku).
// - Retorna { deleted, blocked }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const masterIds: string[] = Array.isArray(body.master_ids) ? body.master_ids : [];
    const parentSkusIn: string[] = Array.isArray(body.parent_skus) ? body.parent_skus : [];

    if (masterIds.length === 0 && parentSkusIn.length === 0) {
      return json({ error: "master_ids ou parent_skus obrigatório" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolver pares
    const pairs = new Map<string, { master_id: string | null; sku_root: string | null }>();

    if (masterIds.length > 0) {
      const { data } = await supabase
        .from("products_master")
        .select("id, sku_root")
        .in("id", masterIds);
      for (const m of data || []) {
        pairs.set(m.id, { master_id: m.id, sku_root: m.sku_root });
      }
      // Ids que não existem — ainda tentar apagar por id no final
      for (const id of masterIds) if (!pairs.has(id)) pairs.set(id, { master_id: id, sku_root: null });
    }

    if (parentSkusIn.length > 0) {
      const { data } = await supabase
        .from("products_master")
        .select("id, sku_root")
        .in("sku_root", parentSkusIn);
      const foundByRoot = new Map<string, string>();
      for (const m of data || []) foundByRoot.set(m.sku_root, m.id);

      for (const sku of parentSkusIn) {
        const master_id = foundByRoot.get(sku) || null;
        const key = master_id || `parent:${sku}`;
        if (!pairs.has(key)) pairs.set(key, { master_id, sku_root: sku });
      }
    }

    const allSkuRoots = Array.from(pairs.values()).map(p => p.sku_root).filter(Boolean) as string[];
    const allMasterIds = Array.from(pairs.values()).map(p => p.master_id).filter(Boolean) as string[];

    // Bloqueio por histórico de vendas: qualquer sku ou parent_sku em pos_sale_items
    const blocked: Array<{ sku_root: string | null; master_id: string | null; reason: string }> = [];
    const blockedRoots = new Set<string>();

    if (allSkuRoots.length > 0) {
      const { data: sales } = await supabase
        .from("pos_sale_items")
        .select("sku, parent_sku")
        .or(allSkuRoots.map(r => `parent_sku.eq.${r}`).join(","));
      const soldRoots = new Set<string>();
      for (const s of sales || []) {
        if (s.parent_sku && allSkuRoots.includes(s.parent_sku)) soldRoots.add(s.parent_sku);
      }
      for (const root of soldRoots) {
        blockedRoots.add(root);
        const p = Array.from(pairs.values()).find(v => v.sku_root === root);
        blocked.push({ sku_root: root, master_id: p?.master_id || null, reason: "histórico de venda" });
      }
    }

    const toDeleteMasterIds: string[] = [];
    const toDeleteParentSkus: string[] = [];
    for (const p of pairs.values()) {
      if (p.sku_root && blockedRoots.has(p.sku_root)) continue;
      if (p.master_id) toDeleteMasterIds.push(p.master_id);
      if (p.sku_root) toDeleteParentSkus.push(p.sku_root);
    }

    let deletedLegacy = 0, deletedUnified = 0, deletedPos = 0;

    if (toDeleteParentSkus.length > 0) {
      const { count: cPos } = await supabase
        .from("pos_products")
        .delete({ count: "exact" })
        .in("parent_sku", toDeleteParentSkus);
      deletedPos = cPos || 0;

      const { count: cUni } = await supabase
        .from("product_master_data")
        .delete({ count: "exact" })
        .in("parent_sku", toDeleteParentSkus);
      deletedUnified = cUni || 0;
    }

    if (toDeleteMasterIds.length > 0) {
      // product_variants tem FK ON DELETE CASCADE em master_id
      const { count: cLeg } = await supabase
        .from("products_master")
        .delete({ count: "exact" })
        .in("id", toDeleteMasterIds);
      deletedLegacy = cLeg || 0;
    }

    // Log
    await supabase.from("catalog_sync_log").insert({
      run_id: crypto.randomUUID(),
      operation: masterIds.length > 0 ? "bulk_delete_from_legacy" : "bulk_delete_from_unified",
      details: {
        requested: { master_ids: masterIds.length, parent_skus: parentSkusIn.length },
        deleted: { legacy: deletedLegacy, unified: deletedUnified, pos_products: deletedPos },
        blocked: blocked.length,
        at: new Date().toISOString(),
      },
    });

    return json({
      deleted: { legacy: deletedLegacy, unified: deletedUnified, pos_products: deletedPos },
      blocked,
    });
  } catch (err) {
    console.error("[delete-master-products]", err);
    return json({ error: String(err?.message || err) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
