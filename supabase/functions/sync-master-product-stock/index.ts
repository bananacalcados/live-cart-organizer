// Sincroniza o estoque atual (product_variants.initial_stock) com:
//  - pos_products.stock (todas as lojas, agrupadas por barcode)
//  - Shopify (inventory_levels.set para cada variante)
//
// Body: { master_id, target?: 'pos' | 'shopify' | 'both' (default), distribute_pos?: 'replicate' | 'split' (default replicate) }
//
// Estratégia POS: por padrão replica o estoque do master em todas as lojas
// (cada loja recebe o mesmo valor). Use 'split' para dividir igualmente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { master_id, target = "both", distribute_pos = "replicate" } = await req.json();
    if (!master_id) {
      return new Response(JSON.stringify({ error: "master_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: variants } = await supabase
      .from("product_variants")
      .select("*")
      .eq("master_id", master_id);

    if (!variants?.length) {
      return new Response(JSON.stringify({ error: "Nenhuma variação encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result: Record<string, unknown> = {};

    // ====================== POS ======================
    if (target === "pos" || target === "both") {
      const { data: stores } = await supabase.from("pos_stores").select("id, name");
      const storeIds = (stores || []).map((s: any) => s.id);

      let posUpdated = 0;
      let posMissing = 0;

      for (const v of variants) {
        if (!v.gtin) continue;
        const stockMaster = Number(v.initial_stock || 0);
        const perStoreStock = distribute_pos === "split" && storeIds.length > 0
          ? Math.floor(stockMaster / storeIds.length)
          : stockMaster;

        for (const storeId of storeIds) {
          const { data: existing } = await supabase
            .from("pos_products")
            .select("id")
            .eq("store_id", storeId)
            .eq("barcode", v.gtin)
            .maybeSingle();

          if (existing) {
            const { error } = await supabase
              .from("pos_products")
              .update({ stock: perStoreStock })
              .eq("id", existing.id);
            if (!error) posUpdated++;
          } else {
            posMissing++;
          }
        }
      }
      result.pos = {
        updated: posUpdated,
        missing: posMissing,
        stores: storeIds.length,
        strategy: distribute_pos,
      };
    }

    // ====================== Shopify ======================
    if (target === "shopify" || target === "both") {
      const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
      const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

      if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
        result.shopify = { skipped: "credenciais não configuradas" };
      } else {
        const apiVer = "2024-10";
        const headers = {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json",
        };

        const pickPrimaryLocation = (locations: Array<{ id: number; name?: string | null; active?: boolean }>) => {
          const active = (locations || []).filter((loc) => loc?.active !== false);
          const preferred = active.find((loc) => String(loc.name || "").toLowerCase().includes("tiny shopify"));
          return preferred || active[0] || locations?.[0] || null;
        };

        // Pega o location_id canônico
        const locRes = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/locations.json`, {
          headers,
        });
        const locJson = await locRes.json().catch(() => ({}));
        const locations = Array.isArray(locJson?.locations) ? locJson.locations : [];
        const primaryLocation = pickPrimaryLocation(locations);
        const locationId = primaryLocation?.id;

        if (!locationId) {
          result.shopify = { error: "Location não encontrado na Shopify" };
        } else {
          let shopUpdated = 0;
          let shopErrors = 0;

          // ESTOQUE COMPARTILHADO: soma do estoque de TODAS as lojas do PDV por GTIN
          const gtins = variants.map((v: any) => v.gtin).filter(Boolean);
          const sharedStockByGtin: Record<string, number> = {};
          if (gtins.length) {
            const { data: posRows } = await supabase
              .from("pos_products")
              .select("barcode, stock")
              .in("barcode", gtins);
            for (const row of posRows || []) {
              const code = String(row.barcode);
              sharedStockByGtin[code] = (sharedStockByGtin[code] || 0) + (Number(row.stock) || 0);
            }
          }

          for (const v of variants) {
            if (!v.shopify_variant_id) continue;

            // Busca o inventory_item_id da variante
            const variantRes = await fetch(
              `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/variants/${v.shopify_variant_id}.json`,
              { headers },
            );
            const variantJson = await variantRes.json().catch(() => ({}));
            const inventoryItemId = variantJson?.variant?.inventory_item_id;
            if (!inventoryItemId) {
              shopErrors++;
              continue;
            }

            // Garante que o inventory_item está sendo rastreado
            await fetch(
              `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/inventory_items/${inventoryItemId}.json`,
              {
                method: "PUT",
                headers,
                body: JSON.stringify({ inventory_item: { id: inventoryItemId, tracked: true } }),
              },
            ).catch(() => {});

            const levelsRes = await fetch(
              `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
              { headers },
            );
            const levelsJson = await levelsRes.json().catch(() => ({}));
            const levels = Array.isArray(levelsJson?.inventory_levels) ? levelsJson.inventory_levels : [];

            for (const level of levels) {
              const currentLocationId = level?.location_id;
              if (!currentLocationId || Number(currentLocationId) === Number(locationId)) continue;
              await fetch(
                `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/inventory_levels/set.json`,
                {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    location_id: currentLocationId,
                    inventory_item_id: inventoryItemId,
                    available: 0,
                  }),
                },
              ).catch(() => {});
            }

            // Define o estoque (compartilhado entre todas as lojas)
            const sharedStock = v.gtin && sharedStockByGtin[String(v.gtin)] !== undefined
              ? sharedStockByGtin[String(v.gtin)]
              : Number(v.initial_stock || 0);
            const setRes = await fetch(
              `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/inventory_levels/set.json`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  location_id: locationId,
                  inventory_item_id: inventoryItemId,
                  available: sharedStock,
                }),
              },
            );

            if (setRes.ok) shopUpdated++;
            else {
              shopErrors++;
              const errBody = await setRes.text().catch(() => "");
              console.error(`Erro estoque Shopify variant ${v.shopify_variant_id}:`, errBody);
            }
          }

          result.shopify = {
            updated: shopUpdated,
            errors: shopErrors,
            location_id: locationId,
          };
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Estoque sincronizado",
        result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
