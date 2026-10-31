import type { ShopifyProduct } from "@/lib/shopify";

export interface CatalogVariant {
  variant_id: string;
  sku: string | null;
  title: string;
  size: string | null;
  color: string | null;
  price: number;
  image: string | null;
  enabled: boolean;
}

const SIZE_RX = /tamanho|numera|size|n[uú]mero/i;
const COLOR_RX = /cor|color/i;

export function variantsFromShopify(p: ShopifyProduct): CatalogVariant[] {
  return p.node.variants.edges.map(({ node: v }) => ({
    variant_id: v.id,
    sku: v.sku || null,
    title: v.title === "Default Title" ? "Único" : v.title,
    size: v.selectedOptions?.find((o) => SIZE_RX.test(o.name))?.value ?? null,
    color: v.selectedOptions?.find((o) => COLOR_RX.test(o.name))?.value ?? null,
    price: parseFloat(v.price.amount),
    image: v.image?.url ?? p.node.images.edges[0]?.node.url ?? null,
    enabled: true,
  }));
}

/** Preço "de" = variante mais barata disponível; compareAt maior vira original e price vira oferta sugerida. */
export function pricingFromShopify(p: ShopifyProduct): { original_price: number; offer_price: number | null } {
  const vs = p.node.variants.edges.map((e) => e.node);
  const pool = vs.filter((v) => v.availableForSale).length ? vs.filter((v) => v.availableForSale) : vs;
  const cheapest = pool.reduce((a, b) => (parseFloat(b.price.amount) < parseFloat(a.price.amount) ? b : a), pool[0]);
  if (!cheapest) return { original_price: 0, offer_price: null };
  const price = parseFloat(cheapest.price.amount);
  const cmp = cheapest.compareAtPrice ? parseFloat(cheapest.compareAtPrice.amount) : 0;
  return cmp > price ? { original_price: cmp, offer_price: price } : { original_price: price, offer_price: null };
}

/** Atualização da Shopify preserva o "enabled" das variantes já existentes; novas chegam ligadas. */
export function mergeVariants(current: CatalogVariant[], fresh: CatalogVariant[]): CatalogVariant[] {
  const prev = new Map(current.map((v) => [v.variant_id, v.enabled]));
  return fresh.map((v) => ({ ...v, enabled: prev.has(v.variant_id) ? prev.get(v.variant_id)! : true }));
}
