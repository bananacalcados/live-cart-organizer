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

    if (!master.shopify_product_id) {
      return new Response(
        JSON.stringify({ error: "Produto ainda não foi enviado à Shopify. Use o botão 'Enviar para Shopify' primeiro." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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

    // 2. Atualiza variantes (preço, peso, sku, barcode)
    let variantUpdates = 0;
    let variantErrors = 0;

    for (const v of variants) {
      if (!v.shopify_variant_id) {
        // Variante criada localmente que ainda não tem ID Shopify — ignora
        continue;
      }
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
        message: `Produto atualizado na Shopify: ${variantUpdates} variantes atualizadas${variantErrors > 0 ? `, ${variantErrors} erros` : ""}`,
        shopify_product_id: shopifyProductId,
        variants_updated: variantUpdates,
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
