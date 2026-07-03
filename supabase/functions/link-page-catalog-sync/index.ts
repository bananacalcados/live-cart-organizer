// Sincroniza o catálogo de produtos de uma Link Page a partir da Shopify.
// Regras: só produtos COM FOTO e com grade de tamanhos >= 60% disponível.
// Modos: 'manual' (apenas reavalia grade dos já marcados), 'lancamentos',
// 'mais_vendidos', 'todos' (puxa automaticamente da Shopify).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHOPIFY_API_VERSION = "2025-07";
const SHOPIFY_STORE_DOMAIN = "ftx2e2-np.myshopify.com";
const SHOPIFY_STOREFRONT_TOKEN = "01d9be4b81f3be57729bc07e9d552252";
const SHOPIFY_URL = `https://${SHOPIFY_STORE_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;

const MIN_GRADE_PCT = 0.6; // 60%
const MAX_PRODUCTS = 18;

const QUERY = `
  query GetProducts($first: Int!, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
    products(first: $first, query: $query, sortKey: $sortKey, reverse: $reverse) {
      edges {
        node {
          id
          title
          handle
          productType
          createdAt
          priceRange { minVariantPrice { amount } }
          compareAtPriceRange { minVariantPrice { amount } }
          images(first: 1) { edges { node { url } } }
          options { name values }
          variants(first: 100) {
            edges { node { availableForSale price { amount } compareAtPrice { amount } selectedOptions { name value } } }
          }
        }
      }
    }
  }
`;

const SINGLE_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) {
      id title handle productType
      priceRange { minVariantPrice { amount } }
      compareAtPriceRange { minVariantPrice { amount } }
      images(first: 1) { edges { node { url } } }
      options { name values }
      variants(first: 100) { edges { node { availableForSale price { amount } compareAtPrice { amount } selectedOptions { name value } } } }
    }
  }
`;

const SIZE_RE = /tamanho|numera|n[uú]mero|size/i;

function computeGrade(node: any): { total: number; available: number; pct: number } {
  const sizeOption = (node.options || []).find((o: any) => SIZE_RE.test(o.name));
  const variants = (node.variants?.edges || []).map((e: any) => e.node);
  if (sizeOption) {
    const total = sizeOption.values.length;
    const availableSizes = new Set<string>();
    for (const v of variants) {
      if (!v.availableForSale) continue;
      const so = (v.selectedOptions || []).find((s: any) => SIZE_RE.test(s.name));
      if (so) availableSizes.add(so.value);
    }
    const available = availableSizes.size;
    return { total, available, pct: total ? available / total : 0 };
  }
  // fallback: usa variantes
  const total = variants.length;
  const available = variants.filter((v: any) => v.availableForSale).length;
  return { total, available, pct: total ? available / total : 0 };
}

// Preço REAL de venda (com desconto) + preço "de" (compare-at) a partir das variações.
// variant.price = valor já com desconto; variant.compareAtPrice = valor original.
function computePricing(node: any): { price: number; compareAtPrice: number | null } {
  const variants = (node.variants?.edges || []).map((e: any) => e.node);
  let candidates = variants.filter((v: any) => v.availableForSale);
  if (!candidates.length) candidates = variants;
  let price = Infinity;
  let compareAtPrice: number | null = null;
  for (const v of candidates) {
    const p = Number(v.price?.amount || 0);
    if (!p) continue;
    if (p < price) {
      price = p;
      const cmp = v.compareAtPrice ? Number(v.compareAtPrice.amount || 0) : 0;
      compareAtPrice = cmp > p ? cmp : null;
    }
  }
  if (!Number.isFinite(price)) price = Number(node.priceRange?.minVariantPrice?.amount || 0);
  return { price, compareAtPrice };
}



async function shopify(query: string, variables: Record<string, unknown>) {
  const r = await fetch(SHOPIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}`);
  const data = await r.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { pageId } = await req.json();
    if (!pageId) {
      return new Response(JSON.stringify({ error: "pageId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: page } = await supabase
      .from("link_pages")
      .select("id, catalog_mode")
      .eq("id", pageId)
      .maybeSingle();
    if (!page) {
      return new Response(JSON.stringify({ error: "page not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mode = page.catalog_mode || "manual";
    let activated = 0, deactivated = 0;

    if (mode === "manual") {
      // Reavalia a grade dos produtos já marcados
      const { data: existing } = await supabase
        .from("link_page_catalog_products")
        .select("id, shopify_product_id")
        .eq("page_id", pageId);
      for (const row of existing || []) {
        try {
          const d = await shopify(SINGLE_QUERY, { id: row.shopify_product_id });
          const node = d?.product;
          if (!node) { await supabase.from("link_page_catalog_products").update({ is_active: false }).eq("id", row.id); deactivated++; continue; }
          const g = computeGrade(node);
          const hasImage = !!node.images?.edges?.[0]?.node?.url;
          const ok = hasImage && g.pct >= MIN_GRADE_PCT;
          const pr = computePricing(node);
          await supabase.from("link_page_catalog_products").update({
            grade_total: g.total, grade_available: g.available, grade_pct: Number(g.pct.toFixed(3)),
            is_active: ok, last_synced_at: new Date().toISOString(),
            image_url: node.images?.edges?.[0]?.node?.url || null,
            price: pr.price,
            compare_at_price: pr.compareAtPrice,
          }).eq("id", row.id);
          ok ? activated++ : deactivated++;
        } catch (e) { console.error("manual eval", row.shopify_product_id, e); }
      }
      return new Response(JSON.stringify({ success: true, mode, activated, deactivated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modos automáticos
    let sortKey = "BEST_SELLING", reverse = false, isNew = false, isBest = false;
    if (mode === "lancamentos") { sortKey = "CREATED_AT"; reverse = true; isNew = true; }
    else if (mode === "mais_vendidos") { sortKey = "BEST_SELLING"; isBest = true; }
    else { sortKey = "BEST_SELLING"; } // todos

    const d = await shopify(QUERY, { first: 60, query: "available_for_sale:true", sortKey, reverse });
    const edges = d?.products?.edges || [];

    const qualified: any[] = [];
    for (const e of edges) {
      const node = e.node;
      const hasImage = !!node.images?.edges?.[0]?.node?.url;
      if (!hasImage) continue;
      const g = computeGrade(node);
      if (g.pct < MIN_GRADE_PCT) continue;
      qualified.push({ node, g });
      if (qualified.length >= MAX_PRODUCTS) break;
    }

    const keepIds = new Set(qualified.map((q) => q.node.id));

    // Desativa os que não qualificam mais
    const { data: existing } = await supabase
      .from("link_page_catalog_products")
      .select("id, shopify_product_id")
      .eq("page_id", pageId);
    for (const row of existing || []) {
      if (!keepIds.has(row.shopify_product_id)) {
        await supabase.from("link_page_catalog_products").update({ is_active: false }).eq("id", row.id);
        deactivated++;
      }
    }

    // Upsert dos qualificados
    let order = 0;
    for (const { node, g } of qualified) {
      const pr = computePricing(node);
      await supabase.from("link_page_catalog_products").upsert({
        page_id: pageId,
        shopify_product_id: node.id,
        handle: node.handle,
        title: node.title,
        image_url: node.images?.edges?.[0]?.node?.url || null,
        price: pr.price,
        compare_at_price: pr.compareAtPrice,
        product_type: node.productType,
        grade_total: g.total, grade_available: g.available, grade_pct: Number(g.pct.toFixed(3)),
        is_active: true, is_new_arrival: isNew, is_bestseller: isBest,
        sort_order: order++, last_synced_at: new Date().toISOString(),
      }, { onConflict: "page_id,shopify_product_id" });
      activated++;
    }

    return new Response(JSON.stringify({ success: true, mode, activated, deactivated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[link-page-catalog-sync]", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
