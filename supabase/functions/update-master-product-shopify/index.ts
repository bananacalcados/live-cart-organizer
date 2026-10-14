// Atualiza um produto JÁ EXISTENTE na Shopify (idempotente).
// Usa shopify_product_id armazenado em products_master.
// Atualiza dados do produto pai (título, descrição, marca, imagens) e
// dos variantes existentes (preço, peso, sku, barcode). NÃO altera estoque
// (use sync-master-product-stock para isso).

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
    const { master_id } = await req.json();
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

    const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
    const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Credenciais Shopify não configuradas" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: master } = await supabase
      .from("products_master")
      .select("*")
      .eq("id", master_id)
      .single();

    if (!master) {
      return new Response(JSON.stringify({ error: "Produto não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiVerCheck = "2024-10";

    // Auto-recriação: se o produto foi apagado na Shopify (ou nunca enviado),
    // limpa os IDs locais e recria via create-master-product-shopify.
    async function recreate(reason: string) {
      await supabase
        .from("products_master")
        .update({ shopify_product_id: null })
        .eq("id", master_id);
      await supabase
        .from("product_variants")
        .update({ shopify_variant_id: null })
        .eq("master_id", master_id);

      const createRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/create-master-product-shopify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ master_id }),
        },
      );
      const createJson = await createRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ ...createJson, recreated: true, reason }),
        { status: createRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!master.shopify_product_id) {
      return await recreate("produto ainda não existia na Shopify");
    }

    // Verifica se o produto ainda existe na Shopify
    const checkRes = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/${apiVerCheck}/products/${master.shopify_product_id}.json`,
      { headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" } },
    );
    if (checkRes.status === 404) {
      return await recreate("produto foi apagado na Shopify");
    }

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

    const apiVer = "2024-10";
    const shopifyProductId = master.shopify_product_id;

    // 1. Atualiza dados do produto pai
    const productUpdate = {
      product: {
        id: Number(shopifyProductId),
        title: master.name,
        body_html: master.description || "",
        vendor: master.brand || "",
        product_type: master.category || "",
        status: master.is_active ? "active" : "draft",
        images: (master.images || []).map((src: string) => ({ src })),
      },
    };

    const productUrl = `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/products/${shopifyProductId}.json`;
    const productRes = await fetch(productUrl, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(productUpdate),
    });

    if (!productRes.ok) {
      const err = await productRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: "Shopify retornou erro ao atualizar produto", details: err }),
        { status: productRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Atualiza variantes (preço, peso, sku, barcode) e CRIA as novas
    let variantUpdates = 0;
    let variantErrors = 0;
    let variantsCreated = 0;
    const createErrors: string[] = [];

    const checkJson = await checkRes.json().catch(() => ({}));
    const shopProduct = checkJson?.product || {};
    const optionNames: string[] = (shopProduct.options || []).map((o: any) => String(o.name || ""));
    const existingCombos = new Set<string>(
      (shopProduct.variants || []).map((sv: any) =>
        [sv.option1, sv.option2, sv.option3].map((x: any) => String(x ?? "").trim().toLowerCase()).join("|")
      ),
    );
    const norm = (s: any) => String(s ?? "").replace(/\s+/g, " ").trim();
    const optValueFor = (v: any, name: string) => {
      const n = name.toLowerCase();
      if (n.includes("cor") || n.includes("color")) return norm(v.color) || "Único";
      if (n.includes("tam") || n.includes("size")) return norm(v.size) || "Único";
      return norm(v.size) || norm(v.color) || "Único";
    };

    // Estoque compartilhado (soma de todas as lojas por GTIN)
    const newOnes = variants.filter((v: any) => !v.shopify_variant_id);
    const stockByGtin: Record<string, number> = {};
    const newGtins = newOnes.map((v: any) => v.gtin).filter(Boolean);
    if (newGtins.length) {
      const { data: posRows } = await supabase.from("pos_products").select("barcode, stock").in("barcode", newGtins);
      for (const r of posRows || []) {
        const k = String(r.barcode);
        stockByGtin[k] = (stockByGtin[k] || 0) + (Number(r.stock) || 0);
      }
    }
    let locationId: number | null = null;
    if (newOnes.length) {
      const locRes = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/locations.json`, {
        headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN },
      });
      const locJson = await locRes.json().catch(() => ({}));
      locationId = (locJson.locations || []).find((l: any) => l.active)?.id ?? locJson.locations?.[0]?.id ?? null;
    }

    for (const v of newOnes as any[]) {
      const opts: Record<string, string> = {};
      const names = optionNames.length && optionNames[0] !== "Title" ? optionNames : ["Tamanho"];
      names.forEach((name, i) => { opts[`option${i + 1}`] = optValueFor(v, name); });
      const comboKey = [opts.option1, opts.option2, opts.option3].map((x) => String(x ?? "").trim().toLowerCase()).join("|");
      if (existingCombos.has(comboKey)) {
        createErrors.push(`${Object.values(opts).join(" / ")} já existe na Shopify`);
        continue;
      }
      const cRes = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/products/${shopifyProductId}/variants.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          variant: {
            ...opts,
            sku: v.sku,
            barcode: v.gtin,
            price: (v.sale_price_override ?? master.sale_price ?? 0).toString(),
            inventory_management: "shopify",
            weight: Number(v.weight_kg_override ?? master.weight_kg ?? 0),
            weight_unit: "kg",
            requires_shipping: true,
          },
        }),
      });
      const cJson = await cRes.json().catch(() => ({}));
      if (!cRes.ok || !cJson?.variant?.id) {
        console.error("Erro criando variante:", JSON.stringify(cJson));
        createErrors.push(`${Object.values(opts).join(" / ")}: ${JSON.stringify(cJson?.errors ?? cJson)}`);
        continue;
      }
      existingCombos.add(comboKey);
      variantsCreated++;
      await supabase.from("product_variants").update({ shopify_variant_id: String(cJson.variant.id) }).eq("id", v.id);
      const qty = v.gtin && stockByGtin[String(v.gtin)] !== undefined ? stockByGtin[String(v.gtin)] : (Number(v.initial_stock) || 0);
      if (locationId && cJson.variant.inventory_item_id) {
        await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/inventory_levels/set.json`, {
          method: "POST",
          headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify({ location_id: locationId, inventory_item_id: cJson.variant.inventory_item_id, available: qty }),
        }).catch((e) => console.error("estoque:", e));
      }
    }

    for (const v of variants) {
      if (!v.shopify_variant_id) continue;
      const price = (v.sale_price_override ?? master.sale_price ?? 0).toString();
      const weight = v.weight_kg_override ?? master.weight_kg ?? 0;

      const variantUpdate = {
        variant: {
          id: Number(v.shopify_variant_id),
          price,
          sku: v.sku,
          barcode: v.gtin,
          weight: Number(weight),
          weight_unit: "kg",
        },
      };

      const vUrl = `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/variants/${v.shopify_variant_id}.json`;
      const vRes = await fetch(vUrl, {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(variantUpdate),
      });

      if (vRes.ok) {
        variantUpdates++;
      } else {
        variantErrors++;
        const errBody = await vRes.text().catch(() => "");
        console.error(`Erro variante ${v.shopify_variant_id}:`, errBody);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Produto atualizado na Shopify: ${variantUpdates} variantes atualizadas, ${variantsCreated} novas criadas${variantErrors + createErrors.length > 0 ? `, ${variantErrors + createErrors.length} erros` : ""}`,
        shopify_product_id: shopifyProductId,
        variants_updated: variantUpdates,
        variants_created: variantsCreated,
        create_errors: createErrors,
        variant_errors: variantErrors,
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
