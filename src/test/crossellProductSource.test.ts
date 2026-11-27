import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchProducts = vi.fn(async () => [{ node: { id: "gid://shopify/Product/1" } }]);
const rpc = vi.fn();
let stored: unknown = "shopify";
vi.mock("@/lib/shopify", () => ({ fetchProducts: (...a: unknown[]) => fetchProducts(...(a as [])) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: stored } }) }) }) }) } }));

import { __resetProductSource, erpItemToShopifyProduct, erpMasterOf, fetchCrossellProducts, getProductSource, promoKeyOf, type ErpCatalogItem } from "@/lib/liveProductSource";
import { variantsFromShopify } from "@/lib/liveCatalog";

const erpOnly: ErpCatalogItem = {
  master_id: "m-1", name: "Sapatilha ERP", description: null, category: "Sapatilha", brand: "B Confort",
  sale_price: 129.99, shopify_product_id: null, hit_variant_id: null,
  variants: [{ variant_id: "v-1", sku: "S-36", gtin: "7890", color: "Nude", size: "36", price: 129.99, shopify_variant_id: null, live_code: null, image: null, image_source: null, stock_perola: 0 }],
};

beforeEach(() => { fetchProducts.mockClear(); rpc.mockReset(); __resetProductSource("product_source_crossell"); });

describe("interruptor product_source_crossell", () => {
  it("nasce/lê 'shopify' e chama a Shopify exatamente como antes", async () => {
    stored = "shopify";
    expect(await getProductSource("product_source_crossell")).toBe("shopify");
    await fetchCrossellProducts(50, "presto");
    expect(fetchProducts).toHaveBeenCalledWith(50, "presto", undefined);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("valor desconhecido mantém a Shopify", async () => {
    stored = { x: 1 };
    expect(await getProductSource("product_source_crossell")).toBe("shopify");
  });
  it("com 'erp' usa a busca do ERP e não a Shopify", async () => {
    __resetProductSource("product_source_crossell", "erp");
    rpc.mockResolvedValue({ data: { total: 1, items: [erpOnly] }, error: null });
    const r = await fetchCrossellProducts(20, "sapatilha");
    expect(fetchProducts).not.toHaveBeenCalled();
    expect(r[0].node.id).toBe("erp-product:m-1");
  });
});

describe("item só do ERP no catálogo/cross-sell/promoção", () => {
  const p = erpItemToShopifyProduct(erpOnly);
  it("variação do catálogo guarda ids do ERP e o código", () => {
    const [v] = variantsFromShopify(p);
    expect(v).toMatchObject({ variant_id: "erp-variant:v-1", sku: "7890", erp_variant_id: "v-1", erp_master_id: "m-1", price: 129.99 });
    expect(erpMasterOf(p)).toBe("m-1");
  });
  it("chave de promoção: Shopify = número; só ERP = erp:<id>", () => {
    expect(promoKeyOf("gid://shopify/Product/123")).toBe("123");
    expect(promoKeyOf("erp-product:m-1")).toBe("erp:m-1");
    expect(promoKeyOf("", "m-1")).toBe("erp:m-1");
  });
  it("preço 'de' vazio vindo do ERP", () => {
    expect(p.node.variants.edges[0].node.compareAtPrice).toBeNull();
  });
});
