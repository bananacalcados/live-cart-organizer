// shopify-mirror-stock
// Push ATIVO de estoque para a Shopify a cada venda (PDV / Site / Live).
// Disparado pelo trigger apply_pos_sale_stock_movement via net.http_post (event-driven, sem cron).
//
// Estratégia: SET ABSOLUTO. Para cada barcode vendido, recalcula o estoque
// COMPARTILHADO (soma de pos_products.stock de TODAS as lojas por barcode) e
// grava esse valor absoluto na variante correspondente da Shopify
// (inventory_levels/set). Isso é idempotente e auto-corretivo — evita drift e
// dupla baixa mesmo quando o pedido nasceu na própria Shopify.
//
// Body: { items: [{ barcode?, sku? }], sale_id?, sale_event? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_VER = "2024-10";

type InItem = { barcode?: string | null; sku?: string | null };

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
    const saleId = body?.sale_id ?? null;
    const saleEvent = body?.sale_event ?? "sale";
    const items: InItem[] = Array.isArray(body?.items) ? body.items : [];

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

    // Barcodes/SKUs únicos
    const barcodes = Array.from(
      new Set(items.map((i) => (i.barcode || "").trim()).filter(Boolean)),
    );
    const skus = Array.from(
      new Set(items.map((i) => (i.sku || "").trim()).filter(Boolean)),
    );

    if (!barcodes.length && !skus.length) {
      return new Response(JSON.stringify({ ok: true, skipped: "no items" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mapeia para variantes da Shopify via product_variants (gtin = barcode, fallback sku)
    const variantMap = new Map<string, { shopify_variant_id: string; gtin: string | null }>();
    if (barcodes.length) {
      const { data } = await supabase
        .from("product_variants")
        .select("gtin, sku, shopify_variant_id")
        .in("gtin", barcodes)
        .not("shopify_variant_id", "is", null);
      for (const v of data || []) {
        if (v.gtin && v.shopify_variant_id) variantMap.set(String(v.gtin), { shopify_variant_id: String(v.shopify_variant_id), gtin: v.gtin });
      }
    }
    // Itens cujo barcode não casou: tenta por SKU
    const missingSkus = skus.filter((sk) => {
      const it = items.find((i) => (i.sku || "").trim() === sk);
      const bc = (it?.barcode || "").trim();
      return !(bc && variantMap.has(bc));
    });
    if (missingSkus.length) {
      const { data } = await supabase
        .from("product_variants")
        .select("gtin, sku, shopify_variant_id")
        .in("sku", missingSkus)
        .not("shopify_variant_id", "is", null);
      for (const v of data || []) {
        const key = v.gtin ? String(v.gtin) : `sku:${v.sku}`;
        if (v.shopify_variant_id && !variantMap.has(key)) {
          variantMap.set(key, { shopify_variant_id: String(v.shopify_variant_id), gtin: v.gtin ?? null });
        }
      }
    }

    if (variantMap.size === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: "no shopify variants matched" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Location principal da Shopify
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

    // Somar estoque APENAS das lojas reais (exclui simulações do Gestão > Formação de Margem)
    const { data: realStores } = await supabase
      .from("pos_stores")
      .select("id")
      .eq("is_active", true)
      .eq("is_simulation", false);
    const realStoreIds = (realStores || []).map((s: any) => s.id);

    for (const [key, v] of variantMap.entries()) {
      try {
        // Estoque COMPARTILHADO = soma das lojas REAIS por barcode
        let shared = 0;
        const barcode = v.gtin || (key.startsWith("sku:") ? null : key);
        if (barcode && realStoreIds.length > 0) {
          const { data: posRows } = await supabase
            .from("pos_products")
            .select("stock")
            .eq("barcode", barcode)
            .in("store_id", realStoreIds);
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
          results.push({ variant: v.shopify_variant_id, ok: false, error: "inventory_item_id not found" });
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
          results.push({ variant: v.shopify_variant_id, ok: true, available: shared, location_id: locationId });
        } else {
          const errText = await setRes.text().catch(() => "");
          results.push({ variant: v.shopify_variant_id, ok: false, error: errText.slice(0, 200) });
          console.error(`shopify set fail variant ${v.shopify_variant_id}:`, errText);
        }
      } catch (e: any) {
        results.push({ variant: v.shopify_variant_id, ok: false, error: String(e?.message || e) });
        console.error("shopify-mirror-stock item error", e);
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    console.log(`shopify-mirror-stock sale=${saleId} event=${saleEvent} updated=${okCount}/${results.length}`);

    return new Response(JSON.stringify({ ok: true, sale_id: saleId, updated: okCount, total: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("shopify-mirror-stock error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
