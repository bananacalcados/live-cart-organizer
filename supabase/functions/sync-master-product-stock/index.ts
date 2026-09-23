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
    const { master_id, target = "both", store_id: body_store_id = null } = await req.json();
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
    // ATENÇÃO: nunca replica estoque em todas as lojas. store_id é OBRIGATÓRIO
    // quando target inclui 'pos'. Apenas a loja indicada recebe o estoque das
    // variantes; as demais lojas não são tocadas.
    if (target === "pos" || target === "both") {
      const store_id: string | null = body_store_id;
      if (!store_id) {
        return new Response(JSON.stringify({
          error: "store_id obrigatório para sincronizar estoque no PDV",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Bloqueia lojas simulação e buckets online (Site/Live, Site + Centro, Lojas + Live)
      const { data: store } = await supabase
        .from("pos_stores")
        .select("id, name, is_simulation")
        .eq("id", store_id)
        .maybeSingle();
      if (!store || store.is_simulation) {
        return new Response(JSON.stringify({
          error: "Loja inválida ou de simulação",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const nameNorm = String(store.name || "").toLowerCase();
      const isOnlineBucket = ["site/live", "site + centro", "lojas + live"].some(n => nameNorm.includes(n));
      if (isOnlineBucket) {
        return new Response(JSON.stringify({
          error: `A loja "${store.name}" é um agregador online e não recebe estoque via sincronização.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let posUpdated = 0;
      let posMissing = 0;

      for (const v of variants) {
        if (!v.gtin) continue;
        const stockMaster = Number(v.initial_stock || 0);

        const { data: existing } = await supabase
          .from("pos_products")
          .select("id")
          .eq("store_id", store_id)
          .eq("barcode", v.gtin)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase
            .from("pos_products")
            .update({ stock: stockMaster })
            .eq("id", existing.id);
          if (!error) posUpdated++;
        } else {
          posMissing++;
        }
      }
      result.pos = {
        updated: posUpdated,
        missing: posMissing,
        store_id,
        store_name: store.name,
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

        // Shopify limita ~2 chamadas/s. Espera e repete quando estourar.
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const shopFetch = async (url: string, init?: RequestInit) => {
          for (let attempt = 0; attempt < 5; attempt++) {
            const res = await fetch(url, init);
            if (res.status !== 429) return res;
            await sleep(600 * (attempt + 1));
          }
          return await fetch(url, init);
        };

        // ============ NOVAS VARIAÇÕES ============
        // A Shopify permite adicionar variantes a um produto já existente
        // (POST /products/{id}/variants.json, limite de 100 por produto).
        // Antes de mexer no estoque, criamos na Shopify toda variação local
        // que ainda não tem shopify_variant_id — ou vinculamos pelo GTIN/SKU
        // quando ela já existe lá.
        const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
        let variantsCreated = 0;
        let variantsLinked = 0;
        const variantCreateErrors: string[] = [];

        const { data: masterRow } = await supabase
          .from("products_master")
          .select("shopify_product_id, sale_price, weight_kg")
          .eq("id", master_id)
          .maybeSingle();

        const shopifyProductId = masterRow?.shopify_product_id;
        const pending = (variants as any[]).filter((v) => !v.shopify_variant_id);

        if (shopifyProductId && pending.length) {
          const prodRes = await fetch(
            `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/products/${shopifyProductId}.json`,
            { headers },
          );
          const prodJson = await prodRes.json().catch(() => ({}));
          const shopProduct = prodJson?.product;

          if (!shopProduct) {
            variantCreateErrors.push("Produto não encontrado na Shopify");
          } else {
            const options: any[] = (shopProduct.options || []).slice().sort(
              (a: any, b: any) => (a.position || 0) - (b.position || 0),
            );
            const existing: any[] = shopProduct.variants || [];

            const optionValueFor = (optName: string, v: any) => {
              const n = optName.toLowerCase();
              if (/cor|color|colour/.test(n)) return norm(v.color) || "Único";
              if (/tamanho|numera|n[uú]mero|size/.test(n)) return norm(v.size) || "Único";
              return norm(v.size) || norm(v.color) || "Único";
            };

            for (const v of pending) {
              // 1. Já existe lá? Vincula pelo código de barras ou SKU.
              const match = existing.find(
                (ev: any) =>
                  (v.gtin && norm(ev.barcode) === norm(v.gtin)) ||
                  (v.sku && norm(ev.sku).toLowerCase() === norm(v.sku).toLowerCase()),
              );
              if (match) {
                await supabase
                  .from("product_variants")
                  .update({ shopify_variant_id: String(match.id) })
                  .eq("id", v.id);
                v.shopify_variant_id = String(match.id);
                variantsLinked++;
                continue;
              }

              // 2. Cria a nova variação no produto existente.
              const payload: Record<string, unknown> = {
                sku: v.sku,
                barcode: v.gtin,
                price: (v.sale_price_override ?? masterRow?.sale_price ?? 0).toString(),
                inventory_management: "shopify",
                weight: Number(v.weight_kg_override ?? masterRow?.weight_kg ?? 0),
                weight_unit: "kg",
                requires_shipping: true,
              };
              options.forEach((opt: any, i: number) => {
                payload[`option${i + 1}`] = optionValueFor(String(opt.name || ""), v);
              });
              if (!options.length) payload["option1"] = norm(v.size) || norm(v.color) || "Default Title";

              const createRes = await fetch(
                `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/products/${shopifyProductId}/variants.json`,
                { method: "POST", headers, body: JSON.stringify({ variant: payload }) },
              );
              const createJson = await createRes.json().catch(() => ({}));
              if (createRes.ok && createJson?.variant?.id) {
                await supabase
                  .from("product_variants")
                  .update({ shopify_variant_id: String(createJson.variant.id) })
                  .eq("id", v.id);
                v.shopify_variant_id = String(createJson.variant.id);
                existing.push(createJson.variant);
                variantsCreated++;
              } else {
                const detail = typeof createJson?.errors === "string"
                  ? createJson.errors
                  : JSON.stringify(createJson?.errors || createJson);
                variantCreateErrors.push(`${v.sku || v.gtin || "variação"}: ${detail}`);
                console.error("Erro ao criar variante na Shopify:", detail);
              }
            }
          }
        }

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
          result.shopify = {
            error: "Location não encontrado na Shopify",
            variants_created: variantsCreated,
            variants_linked: variantsLinked,
            variant_create_errors: variantCreateErrors,
          };
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
            const variantRes = await shopFetch(
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
            await shopFetch(
              `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/inventory_items/${inventoryItemId}.json`,
              {
                method: "PUT",
                headers,
                body: JSON.stringify({ inventory_item: { id: inventoryItemId, tracked: true } }),
              },
            ).catch(() => {});

            const levelsRes = await shopFetch(
              `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
              { headers },
            );
            const levelsJson = await levelsRes.json().catch(() => ({}));
            const levels = Array.isArray(levelsJson?.inventory_levels) ? levelsJson.inventory_levels : [];

            for (const level of levels) {
              const currentLocationId = level?.location_id;
              if (!currentLocationId || Number(currentLocationId) === Number(locationId)) continue;
              await shopFetch(
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
            const setRes = await shopFetch(
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
            variants_created: variantsCreated,
            variants_linked: variantsLinked,
            variant_create_errors: variantCreateErrors,
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
