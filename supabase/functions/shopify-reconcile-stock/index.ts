// shopify-reconcile-stock
// Tarefa pontual (one-off) para reconciliar TODO o estoque da Shopify com o
// estoque real do nosso sistema (pos_products), para os produtos JÁ vinculados
// (product_variants.shopify_variant_id IS NOT NULL).
//
// Estratégia: SET ABSOLUTO. Para cada variante vinculada, calcula o estoque
// COMPARTILHADO (soma de pos_products.stock de TODAS as lojas por barcode/gtin)
// e grava esse valor na Shopify (inventory_levels/set). Idempotente.
//
// Suporta paginação para evitar timeout:
//   Body: { offset?: number, limit?: number }
//   Resposta: { ok, processed, updated, total, next_offset, done, results }
//
// Chame repetidamente incrementando offset até done=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_VER = "2024-10";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pickPrimaryLocation(locations: Array<{ id: number; name?: string | null; active?: boolean }>) {
  const active = (locations || []).filter((loc) => loc?.active !== false);
  const preferred = active.find((loc) => String(loc.name || "").toLowerCase().includes("tiny shopify"));
  return preferred || active[0] || locations?.[0] || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const offset = Math.max(0, Number(body?.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(body?.limit) || 25));

    const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
    const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return new Response(JSON.stringify({ ok: false, error: "Shopify credentials not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = {
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
    };

    // Total de variantes vinculadas
    const { count: total } = await supabase
      .from("product_variants")
      .select("id", { count: "exact", head: true })
      .not("shopify_variant_id", "is", null);

    // Página atual de variantes vinculadas
    const { data: variants, error: vErr } = await supabase
      .from("product_variants")
      .select("id, gtin, sku, shopify_variant_id")
      .not("shopify_variant_id", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (vErr) throw vErr;

    const rows = variants || [];

    // Location principal da Shopify (uma vez)
    const locRes = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${API_VER}/locations.json`, { headers });
    const locJson = await locRes.json().catch(() => ({}));
    const locations = Array.isArray(locJson?.locations) ? locJson.locations : [];
    const primaryLocation = pickPrimaryLocation(locations);
    const locationId = primaryLocation?.id;
    if (!locationId) {
      return new Response(JSON.stringify({ ok: false, error: "Shopify location not found" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const v of rows) {
      try {
        const barcode = (v.gtin || "").trim();
        // Estoque compartilhado = soma de todas as lojas por barcode
        let shared = 0;
        if (barcode) {
          const { data: posRows } = await supabase
            .from("pos_products")
            .select("stock")
            .eq("barcode", barcode);
          shared = (posRows || []).reduce((acc: number, r: any) => acc + (Number(r.stock) || 0), 0);
        }
        if (shared < 0) shared = 0;

        // inventory_item_id da variante
        const varRes = await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/${API_VER}/variants/${v.shopify_variant_id}.json`,
          { headers },
        );
        const varJson = await varRes.json().catch(() => ({}));
        const inventoryItemId = varJson?.variant?.inventory_item_id;
        if (!inventoryItemId) {
          results.push({ variant: v.shopify_variant_id, gtin: barcode, ok: false, error: "inventory_item_id not found" });
          await sleep(650);
          continue;
        }

        // Garante rastreamento
        await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/${API_VER}/inventory_items/${inventoryItemId}.json`,
          { method: "PUT", headers, body: JSON.stringify({ inventory_item: { id: inventoryItemId, tracked: true } }) },
        ).catch(() => {});

        const levelsRes = await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/${API_VER}/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
          { headers },
        );
        const levelsJson = await levelsRes.json().catch(() => ({}));
        const levels = Array.isArray(levelsJson?.inventory_levels) ? levelsJson.inventory_levels : [];

        for (const level of levels) {
          const currentLocationId = level?.location_id;
          if (!currentLocationId || Number(currentLocationId) === Number(locationId)) continue;
          await fetch(
            `https://${SHOPIFY_DOMAIN}/admin/api/${API_VER}/inventory_levels/set.json`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                location_id: currentLocationId,
                inventory_item_id: inventoryItemId,
                available: 0,
              }),
            },
          );
          await sleep(650);
        }

        // SET absoluto no location canônico
        const setRes = await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/${API_VER}/inventory_levels/set.json`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              location_id: locationId,
              inventory_item_id: inventoryItemId,
              available: shared,
            }),
          },
        );
        if (setRes.ok) {
          results.push({ variant: v.shopify_variant_id, gtin: barcode, ok: true, available: shared, location_id: locationId });
        } else {
          const errText = await setRes.text().catch(() => "");
          results.push({ variant: v.shopify_variant_id, gtin: barcode, ok: false, error: errText.slice(0, 200) });
        }
        await sleep(650);
      } catch (e: any) {
        results.push({ variant: v.shopify_variant_id, ok: false, error: String(e?.message || e) });
        await sleep(650);
      }
    }

    const updated = results.filter((r) => r.ok).length;
    const nextOffset = offset + rows.length;
    const done = nextOffset >= (total || 0) || rows.length === 0;

    console.log(`shopify-reconcile-stock offset=${offset} processed=${rows.length} updated=${updated} total=${total} done=${done}`);

    return new Response(JSON.stringify({
      ok: true,
      processed: rows.length,
      updated,
      total: total || 0,
      next_offset: nextOffset,
      done,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("shopify-reconcile-stock error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
