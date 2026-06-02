// Vincula produtos JÁ EXISTENTES na Shopify ao nosso catálogo (product_variants).
// Casa por GTIN (barcode) primeiro e por SKU como segundo critério.
//
// Modos:
//  - { mode: "dry_run" }  -> lê todos os produtos da Shopify, classifica e
//                            devolve relatório (verde/amarelo/vermelho) SEM gravar.
//  - { mode: "commit", links: [...] } -> grava os vínculos recebidos (apenas verdes).
//
// "links" tem o formato devolvido em dry_run.green:
//   [{ variant_id, master_id, shopify_product_id, shopify_variant_id }]

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const norm = (v: unknown) => (v == null ? "" : String(v).trim());
const normSku = (v: unknown) => norm(v).toUpperCase();

function nextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // formato: <https://...?page_info=XXX&limit=250>; rel="next", <...>; rel="previous"
  for (const part of linkHeader.split(",")) {
    if (part.includes('rel="next"')) {
      const m = part.match(/[?&]page_info=([^&>]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "commit" ? "commit" : "dry_run";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ============ COMMIT ============
    if (mode === "commit") {
      const links = Array.isArray(body.links) ? body.links : [];
      if (links.length === 0) {
        return new Response(
          JSON.stringify({ error: "Nenhum vínculo recebido para gravar" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // sanitiza
      const clean = links
        .filter((l: any) => l && l.variant_id && l.master_id && l.shopify_product_id && l.shopify_variant_id)
        .map((l: any) => ({
          variant_id: String(l.variant_id),
          master_id: String(l.master_id),
          shopify_product_id: String(l.shopify_product_id),
          shopify_variant_id: String(l.shopify_variant_id),
        }));

      const { data, error } = await supabase.rpc("apply_shopify_links", { _links: clean });
      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, linked: data ?? clean.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============ DRY RUN ============
    const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
    const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Credenciais da Shopify não configuradas" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1) Carrega nosso catálogo (paginado) e monta os índices
    const gtinMap = new Map<string, any>(); // gtin -> variante
    const skuMap = new Map<string, any>(); // SKU(upper) -> variante
    {
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("product_variants")
          .select("id, master_id, sku, gtin")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const v of data) {
          const g = norm(v.gtin);
          const s = normSku(v.sku);
          if (g) gtinMap.set(g, v);
          if (s) skuMap.set(s, v);
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
    }

    // 2) Paginação dos produtos da Shopify
    const apiVer = "2024-10";
    const headers = {
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
    };

    const green: any[] = [];
    const yellow: any[] = [];
    const red: any[] = [];
    const usedOurVariant = new Map<string, string>(); // our variant_id -> shopify_variant_id (detecta duplicidade)

    let url: string | null =
      `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/products.json?limit=250&fields=id,title,variants`;
    let shopifyProducts = 0;
    let shopifyVariants = 0;
    let pages = 0;

    while (url) {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Shopify retornou ${res.status}: ${t}`);
      }
      const json = await res.json().catch(() => ({}));
      const products = json?.products || [];
      shopifyProducts += products.length;
      pages++;

      for (const p of products) {
        for (const sv of p.variants || []) {
          shopifyVariants++;
          const barcode = norm(sv.barcode);
          const sku = normSku(sv.sku);
          const base = {
            shopify_product_id: String(p.id),
            shopify_variant_id: String(sv.id),
            shopify_title: norm(p.title),
            shopify_sku: norm(sv.sku),
            shopify_barcode: barcode,
          };

          // 1ª passada: GTIN
          let match = barcode ? gtinMap.get(barcode) : undefined;
          let matchedBy = match ? "gtin" : "";

          // 2ª passada: SKU
          if (!match && sku) {
            const bySku = skuMap.get(sku);
            if (bySku) {
              match = bySku;
              matchedBy = "sku";
            }
          }

          if (!match) {
            red.push(base);
            continue;
          }

          const item = {
            ...base,
            variant_id: match.id,
            master_id: match.master_id,
            our_sku: norm(match.sku),
            our_gtin: norm(match.gtin),
            matched_by: matchedBy,
          };

          // duplicidade: dois anúncios apontando pra mesma variação nossa
          if (usedOurVariant.has(match.id)) {
            yellow.push({ ...item, reason: "variação nossa já vinculada a outro anúncio" });
            continue;
          }

          // casou por SKU mas o GTIN diverge (ambos presentes e diferentes) => amarelo
          if (
            matchedBy === "sku" &&
            barcode &&
            norm(match.gtin) &&
            barcode !== norm(match.gtin)
          ) {
            yellow.push({ ...item, reason: "casou por SKU mas o código de barras diverge" });
            continue;
          }

          usedOurVariant.set(match.id, String(sv.id));
          green.push(item);
        }
      }

      url = nextPageInfo(res.headers.get("link") || res.headers.get("Link"));
      if (url) {
        url = `https://${SHOPIFY_DOMAIN}/admin/api/${apiVer}/products.json?limit=250&page_info=${encodeURIComponent(url)}`;
      }
    }

    const summary = {
      shopify_products: shopifyProducts,
      shopify_variants: shopifyVariants,
      pages,
      green: green.length,
      yellow: yellow.length,
      red: red.length,
      our_variants_indexed: skuMap.size,
    };

    return new Response(
      JSON.stringify({
        success: true,
        mode: "dry_run",
        summary,
        // green completo (necessário para o commit) + amostras de amarelo/vermelho
        green,
        yellow: yellow.slice(0, 500),
        red: red.slice(0, 500),
        yellow_total: yellow.length,
        red_total: red.length,
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
