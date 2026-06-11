// Verifica se os itens de um pedido (orders.products JSONB) têm estoque
// disponível usando o estoque COMPARTILHADO do sistema como fonte da verdade.
// A Shopify é consultada apenas como fallback quando a variação ainda não foi
// encontrada internamente.
//
// Retorna ok=true quando todos os itens têm estoque suficiente (ou não estão
// cadastrados em nenhum dos sistemas — controle externo). Retorna ok=false e a
// lista de itens em falta caso algum item esteja explicitamente sem estoque.

export interface OrderProductLike {
  sku?: string;
  title?: string;
  variant?: string;
  quantity?: number;
  shopifyId?: string; // variant id da Shopify (quando disponível)
}

export interface StockIssue {
  title: string;
  variant?: string;
  sku?: string;
  requested: number;
  available: number;
}

export interface CheckOrderStockResult {
  ok: boolean;
  issues: StockIssue[];
  checked: number;
  skipped_unknown: number;
}

const SHOPIFY_API_VERSION = "2024-10";

async function fetchShopifyVariantStock(
  domain: string,
  token: string,
  variantId: string,
): Promise<number | null> {
  try {
    const variantRes = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/variants/${variantId}.json`,
      { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } },
    );
    if (!variantRes.ok) return null;
    const variantJson = await variantRes.json();
    const inventoryItemId = variantJson?.variant?.inventory_item_id;
    if (!inventoryItemId) return null;

    const levelsRes = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
      { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } },
    );
    if (!levelsRes.ok) return null;
    const levelsJson = await levelsRes.json();
    const levels = levelsJson?.inventory_levels || [];
    let total = 0;
    for (const lv of levels) total += Number(lv?.available || 0);
    return total;
  } catch (e) {
    console.error("[check-order-stock] shopify fetch error:", e);
    return null;
  }
}

// deno-lint-ignore no-explicit-any
export async function checkOrderStock(supabase: any, products: OrderProductLike[]): Promise<CheckOrderStockResult> {
  const issues: StockIssue[] = [];
  let checked = 0;
  let skipped = 0;

  const items = (products || []).filter(Boolean);
  if (items.length === 0) {
    return { ok: true, issues: [], checked: 0, skipped_unknown: 0 };
  }

  const skus = items.map((p) => p?.sku?.toString().trim()).filter(Boolean) as string[];

  // 1) Soma estoque PDV (todas as lojas: PEROLA + CENTRO + outras ativas)
  const stockByBarcode = new Map<string, number>();
  if (skus.length > 0) {
    const { data: rows, error } = await supabase
      .from("pos_products")
      .select("barcode, sku, stock")
      .in("barcode", skus);
    if (error) {
      console.error("[check-order-stock] pos_products db error:", error);
    } else {
      for (const r of rows || []) {
        const key = (r.barcode || r.sku || "").toString();
        if (!key) continue;
        stockByBarcode.set(key, (stockByBarcode.get(key) || 0) + Number(r.stock || 0));
      }
    }
  }

  // 2) Resolve shopify_variant_id por SKU/GTIN (para itens sem shopifyId no payload)
  const shopifyVariantBySku = new Map<string, string>();
  if (skus.length > 0) {
    const { data: variants, error: vErr } = await supabase
      .from("product_variants")
      .select("sku, gtin, shopify_variant_id")
      .or(`sku.in.(${skus.map((s) => `"${s}"`).join(",")}),gtin.in.(${skus.map((s) => `"${s}"`).join(",")})`);
    if (vErr) {
      console.error("[check-order-stock] product_variants lookup error:", vErr);
    } else {
      for (const v of variants || []) {
        if (!v?.shopify_variant_id) continue;
        if (v.sku) shopifyVariantBySku.set(String(v.sku), String(v.shopify_variant_id));
        if (v.gtin) shopifyVariantBySku.set(String(v.gtin), String(v.shopify_variant_id));
      }
    }
  }

  // 3) Para cada item, usa POS como fonte de verdade e Shopify só como fallback
  const SHOPIFY_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN");
  const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN") || Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  const shopifyEnabled = Boolean(SHOPIFY_DOMAIN && SHOPIFY_TOKEN);

  for (const p of items) {
    const sku = p?.sku?.toString().trim() || "";
    const qty = Math.max(1, Number(p.quantity || 1));

    let posStock = sku && stockByBarcode.has(sku) ? (stockByBarcode.get(sku) || 0) : 0;
    let posKnown = sku ? stockByBarcode.has(sku) : false;

    // Resolve variant id Shopify (do payload ou do lookup)
    const variantId = p?.shopifyId?.toString().trim() || shopifyVariantBySku.get(sku) || "";

    let shopifyStock = 0;
    let shopifyKnown = false;
    if (shopifyEnabled && variantId && !posKnown) {
      const v = await fetchShopifyVariantStock(SHOPIFY_DOMAIN!, SHOPIFY_TOKEN!, variantId);
      if (v !== null) {
        shopifyKnown = true;
        shopifyStock = v;
      }
    }

    if (!posKnown && !shopifyKnown) {
      // Produto não cadastrado em nenhum sistema — não bloqueia
      skipped++;
      continue;
    }

    const available = posKnown ? posStock : (shopifyKnown ? shopifyStock : 0);
    checked++;
    if (available < qty) {
      issues.push({
        title: p.title || "Produto",
        variant: p.variant,
        sku,
        requested: qty,
        available,
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    checked,
    skipped_unknown: skipped,
  };
}
