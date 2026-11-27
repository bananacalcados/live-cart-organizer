// Fonte dos produtos da LIVE: Shopify (padrão, comportamento antigo) ou ERP.
// Interruptor: app_settings.product_source_live = "shopify" | "erp".
// Com "shopify", fetchLiveProducts chama exatamente fetchProducts da Shopify.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import type { DbOrderProduct } from "@/types/database";

export type LiveProductSource = "shopify" | "erp";

let sourcePromise: Promise<LiveProductSource> | null = null;

/** Lido uma vez por sessão da aba; qualquer erro mantém a Shopify. */
export function getLiveProductSource(): Promise<LiveProductSource> {
  if (!sourcePromise) {
    sourcePromise = (async () => {
      try {
        const { data } = await (supabase as any).from("app_settings").select("value").eq("key", "product_source_live").maybeSingle();
        const v = typeof data?.value === "string" ? data.value : data?.value?.toString?.();
        return v === "erp" ? "erp" : "shopify";
      } catch {
        return "shopify";
      }
    })();
  }
  return sourcePromise;
}

/** Só para testes. */
export function __resetLiveProductSource(value?: LiveProductSource) {
  sourcePromise = value ? Promise.resolve(value) : null;
}

export function useLiveProductSource(): LiveProductSource | null {
  const [src, setSrc] = useState<LiveProductSource | null>(null);
  useEffect(() => { let on = true; getLiveProductSource().then((s) => on && setSrc(s)); return () => { on = false; }; }, []);
  return src;
}

export interface ErpCatalogVariant {
  variant_id: string; sku: string | null; gtin: string | null; color: string | null; size: string | null;
  price: number | null; shopify_variant_id: string | null; live_code: string | null; image: string | null;
  image_source: "erp" | "shopify" | null; stock_perola: number | null;
}
export interface ErpCatalogItem {
  master_id: string; name: string; description: string | null; category: string | null; brand: string | null;
  sale_price: number | null; shopify_product_id: string | null; hit_variant_id: string | null; variants: ErpCatalogVariant[];
}

export const isErpOnlyId = (id: string | null | undefined) => String(id || "").startsWith("erp-");
export const isShopifyVariantGid = (id: string | null | undefined) => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(String(id || ""));

/** Converte a busca do Shopify (id:1 OR id:2, title:*x*, sku:x) para a busca do ERP. */
export function parseShopifyQuery(query?: string | null): { ids: string[] | null; term: string | null } {
  const q = String(query || "").trim();
  if (!q) return { ids: null, term: null };
  const ids = [...q.matchAll(/\bid:([^\s()]+)/g)].map((m) => m[1].split("/").pop() || m[1]).map((x) => x.replace(/^erp-product:/, ""));
  if (ids.length) return { ids, term: null };
  const first = q.split(/\s+OR\s+/i)[0];
  const term = first.replace(/\b(title|sku|barcode):/gi, "").replace(/\*/g, "").replace(/\s+AND\s+/gi, " ").replace(/["']/g, "").trim();
  return { ids: null, term: term || null };
}

const money = (n: number | null | undefined) => ({ amount: String(Number(n || 0).toFixed(2)), currencyCode: "BRL" });

/** Produto do ERP no MESMO formato que as telas já usam (ShopifyProduct). */
export function erpItemToShopifyProduct(item: ErpCatalogItem): ShopifyProduct {
  const linkedProduct = !!item.shopify_product_id;
  const variants = item.variants || [];
  const images: Array<{ url: string; altText: string | null }> = [];
  const seen = new Set<string>();
  for (const v of variants) {
    if (v.image && !seen.has(v.image)) { seen.add(v.image); images.push({ url: v.image, altText: v.color }); }
  }
  const colors = [...new Set(variants.map((v) => v.color).filter(Boolean))] as string[];
  const sizes = [...new Set(variants.map((v) => v.size).filter(Boolean))] as string[];
  const prices = variants.map((v) => Number(v.price ?? item.sale_price ?? 0)).filter((p) => p > 0);
  const options = [
    ...(colors.length ? [{ name: "Cor", values: colors }] : []),
    ...(sizes.length ? [{ name: "Tamanho", values: sizes }] : []),
  ];
  return {
    node: {
      id: linkedProduct ? `gid://shopify/Product/${item.shopify_product_id}` : `erp-product:${item.master_id}`,
      title: item.name,
      description: item.description || "",
      handle: "",
      productType: item.category || "",
      priceRange: { minVariantPrice: money(prices.length ? Math.min(...prices) : item.sale_price) },
      images: { edges: images.map((node) => ({ node })) },
      collections: { edges: [] },
      options,
      variants: {
        edges: variants.map((v) => {
          const linked = !!v.shopify_variant_id;
          const title = [v.color, v.size].filter(Boolean).join(" / ") || "Default Title";
          return {
            node: {
              id: linked ? `gid://shopify/ProductVariant/${v.shopify_variant_id}` : `erp-variant:${v.variant_id}`,
              title,
              // Código que casa com o estoque do PDV (código de barras primeiro, depois SKU).
              sku: v.gtin || v.sku || null,
              barcode: v.gtin || null,
              price: money(v.price ?? item.sale_price),
              compareAtPrice: null, // preço "de" não existe no ERP: não inventar
              availableForSale: true, // vender sem estoque continua permitido
              quantityAvailable: Number(v.stock_perola || 0),
              selectedOptions: [
                ...(colors.length ? [{ name: "Cor", value: v.color || "" }] : []),
                ...(sizes.length ? [{ name: "Tamanho", value: v.size || "" }] : []),
              ],
              image: v.image ? { url: v.image } : null,
              erp: {
                masterId: item.master_id, variantId: v.variant_id, sku: v.gtin || v.sku || "",
                color: v.color, size: v.size, liveCode: v.live_code, stockPerola: Number(v.stock_perola || 0),
                shopifyLinked: linked, imageSource: v.image_source, isHit: v.variant_id === item.hit_variant_id,
              },
            },
          };
        }),
      },
    },
  };
}

export async function searchErpCatalog(opts: { term?: string | null; ids?: string[] | null; limit?: number; offset?: number }) {
  const { data, error } = await (supabase as any).rpc("erp_catalog_search", {
    p_query: opts.term || null, p_ids: opts.ids && opts.ids.length ? opts.ids : null,
    p_limit: Math.min(opts.limit ?? 30, 50), p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  const items = ((data?.items || []) as ErpCatalogItem[]);
  return { total: Number(data?.total || 0), items, products: items.map(erpItemToShopifyProduct) };
}

/** Substituto de fetchProducts para as telas da live. */
export async function fetchLiveProducts(limit = 250, searchQuery?: string, opts?: { newestFirst?: boolean }): Promise<ShopifyProduct[]> {
  const src = await getLiveProductSource();
  if (src !== "erp") return fetchProducts(limit, searchQuery, opts);
  try {
    const { ids, term } = parseShopifyQuery(searchQuery);
    const { products } = await searchErpCatalog({ ids, term, limit: Math.min(limit, 50) });
    return products;
  } catch (e) {
    console.error("erp_catalog_search", e);
    return [];
  }
}

/** Campos do item do pedido. Produto da Shopify: idêntico ao antigo. Do ERP: grava variação/produto do ERP. */
export function orderItemIdentity(
  variant: ShopifyProduct["node"]["variants"]["edges"][number]["node"],
): Pick<DbOrderProduct, "shopifyId" | "sku" | "erp_variant_id" | "erp_master_id"> {
  if (!variant.erp) return { shopifyId: variant.id, sku: variant.sku || undefined };
  return {
    shopifyId: isShopifyVariantGid(variant.id) ? variant.id : "",
    sku: variant.erp.sku || undefined,
    erp_variant_id: variant.erp.variantId,
    erp_master_id: variant.erp.masterId,
  };
}

/** Itens que não têm variação da Shopify (só do ERP): nunca vão para pedido na Shopify. */
export function erpOnlyItems<T extends { shopifyId?: string | null; variantId?: string | null; erp_variant_id?: string | null }>(items: T[]): T[] {
  return (items || []).filter((p) => !isShopifyVariantGid(p.shopifyId ?? p.variantId) && (p.erp_variant_id || isErpOnlyId(p.variantId)));
}
