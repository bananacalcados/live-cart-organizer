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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
    const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");

    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Credenciais Shopify não configuradas (SHOPIFY_STORE_DOMAIN e SHOPIFY_ACCESS_TOKEN)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: master } = await supabase
      .from("products_master")
      .select("*")
      .eq("id", master_id)
      .single();

    const { data: variants } = await supabase
      .from("product_variants")
      .select("*")
      .eq("master_id", master_id);

    if (!master || !variants?.length) {
      return new Response(JSON.stringify({ error: "Produto/variações não encontrados" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detecta opções (Cor, Tamanho)
    const hasColor = variants.some((v: any) => v.color);
    const hasSize = variants.some((v: any) => v.size);
    const options: { name: string }[] = [];
    if (hasColor) options.push({ name: "Cor" });
    if (hasSize) options.push({ name: "Tamanho" });

    // === ESTOQUE COMPARTILHADO ===
    // A Shopify recebe a SOMA do estoque de TODAS as lojas do PDV (por GTIN/barcode),
    // não o estoque inicial da NF-e nem o de uma loja específica.
    // Ex.: Tiny Shopify 1 + Centro 2 + Perola 3 = 6 pares na Shopify.
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

    const shopifyVariants = variants.map((v: any) => {
      const opts: any = {};
      let i = 1;
      if (hasColor) { opts[`option${i}`] = v.color || "Único"; i++; }
      if (hasSize) { opts[`option${i}`] = v.size || "Único"; i++; }
      // Estoque compartilhado entre todas as lojas (fallback: estoque inicial da variação)
      const sharedStock = v.gtin && sharedStockByGtin[String(v.gtin)] !== undefined
        ? sharedStockByGtin[String(v.gtin)]
        : (Number(v.initial_stock) || 0);
      return {
        ...opts,
        sku: v.sku,
        barcode: v.gtin,
        price: (v.sale_price_override ?? master.sale_price ?? 0).toString(),
        inventory_management: "shopify",
        inventory_quantity: sharedStock,
        weight: (v.weight_kg_override ?? master.weight_kg ?? 0),
        weight_unit: "kg",
        requires_shipping: true,
      };
    });

    const productPayload = {
      product: {
        title: master.name,
        body_html: master.description || "",
        vendor: master.brand || "",
        product_type: master.category || "",
        status: master.is_active ? "active" : "draft",
        images: (master.images || []).map((src: string) => ({ src })),
        options: options.length ? options : [{ name: "Title" }],
        variants: shopifyVariants,
      },
    };

    const apiVer = "2024-10";
    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/products.json`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(productPayload),
    });

    const respJson = await res.json();
    if (!res.ok) {
      console.error("Shopify error:", respJson);
      return new Response(
        JSON.stringify({ error: "Shopify retornou erro", details: respJson }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const shopifyProduct = respJson.product;
    const shopifyProductId = String(shopifyProduct.id);

    // Atualiza master + variantes com IDs Shopify
    await supabase
      .from("products_master")
      .update({ shopify_product_id: shopifyProductId })
      .eq("id", master_id);

    const respVariants = shopifyProduct.variants || [];
    for (let i = 0; i < variants.length && i < respVariants.length; i++) {
      await supabase
        .from("product_variants")
        .update({ shopify_variant_id: String(respVariants[i].id) })
        .eq("id", variants[i].id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        shopify_product_id: shopifyProductId,
        variants_count: respVariants.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
