import { describe, it, expect } from "vitest";
import { mergeVariants, pricingFromShopify } from "@/lib/liveCatalog";

const v = (id: string, enabled: boolean) => ({ variant_id: id, sku: null, title: id, size: null, color: null, price: 10, image: null, enabled });
const prod = (variants: any[]) => ({ node: { images: { edges: [] }, variants: { edges: variants.map((n) => ({ node: n })) } } }) as any;
const pv = (price: string, cmp: string | null, available = true) => ({ price: { amount: price }, compareAtPrice: cmp ? { amount: cmp } : null, availableForSale: available });

describe("catálogo cross-sell", () => {
  it("atualizar da Shopify mantém numerações desligadas e liga as novas", () => {
    const r = mergeVariants([v("a", false), v("b", true)], [v("a", true), v("b", true), v("c", true)]);
    expect(r.map((x) => x.enabled)).toEqual([false, true, true]);
  });
  it("compareAt maior vira preço original e o preço vira oferta", () => {
    expect(pricingFromShopify(prod([pv("199.99", "259.99")]))).toEqual({ original_price: 259.99, offer_price: 199.99 });
  });
  it("sem compareAt usa a variante disponível mais barata, sem oferta", () => {
    expect(pricingFromShopify(prod([pv("150", null), pv("120", null, false), pv("130", null)]))).toEqual({ original_price: 130, offer_price: null });
  });
});
