import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchProducts = vi.fn(async () => [{ node: { id: "gid://shopify/Product/1" } }]);
const rpc = vi.fn();
vi.mock("@/lib/shopify", () => ({ fetchProducts: (...a: unknown[]) => fetchProducts(...(a as [])) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "shopify" } }) }) }) }) } }));

import {
  __resetLiveProductSource, erpItemToShopifyProduct, erpOnlyItems, fetchLiveProducts, orderItemIdentity, parseShopifyQuery,
  type ErpCatalogItem,
} from "@/lib/liveProductSource";

const presto: ErpCatalogItem = {
  master_id: "adc2e374", name: "Tenis Esportivo Nike Presto", description: null, category: null, brand: null,
  sale_price: 259.99, shopify_product_id: "999", hit_variant_id: "v-black-37",
  variants: [
    { variant_id: "v-preto-37", sku: "P-37", gtin: "789001", color: "Preto", size: "37", price: 259.99, shopify_variant_id: "111", live_code: "E018", image: "https://fotos.servidorbanana.com/a.jpg", image_source: "erp", stock_perola: 2 },
    { variant_id: "v-black-37", sku: "PB-37", gtin: "", color: "Preto Black", size: "37", price: 279.99, shopify_variant_id: null, live_code: "E019", image: null, image_source: null, stock_perola: 0 },
  ],
};

beforeEach(() => { fetchProducts.mockClear(); rpc.mockReset(); });

describe("interruptor product_source_live", () => {
  it("com 'shopify' chama a Shopify exatamente como antes", async () => {
    __resetLiveProductSource("shopify");
    const r = await fetchLiveProducts(250, "title:*presto*");
    expect(fetchProducts).toHaveBeenCalledWith(250, "title:*presto*", undefined);
    expect(rpc).not.toHaveBeenCalled();
    expect(r).toHaveLength(1);
  });
  it("com 'erp' usa a busca do ERP paginada (máx. 50), sem chamar a Shopify", async () => {
    __resetLiveProductSource("erp");
    rpc.mockResolvedValue({ data: { total: 1, items: [presto] }, error: null });
    const r = await fetchLiveProducts(250, "title:*presto*");
    expect(fetchProducts).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("erp_catalog_search", { p_query: "presto", p_ids: null, p_limit: 50, p_offset: 0 });
    expect(r[0].node.title).toBe("Tenis Esportivo Nike Presto");
  });
  it("erro na leitura do interruptor mantém a Shopify", async () => {
    __resetLiveProductSource();
    await fetchLiveProducts(10);
    expect(fetchProducts).toHaveBeenCalled();
  });
});

describe("tradução da busca", () => {
  it("ids da Shopify e do ERP", () => {
    expect(parseShopifyQuery("id:1 OR id:2").ids).toEqual(["1", "2"]);
    expect(parseShopifyQuery("id:erp-product:abc").ids).toEqual(["abc"]);
  });
  it("código/sku/barcode e palavras", () => {
    expect(parseShopifyQuery("T176-37 OR sku:T176-37 OR barcode:T176-37").term).toBe("T176-37");
    expect(parseShopifyQuery("title:*nike* AND title:*presto*").term).toBe("nike presto");
  });
});

describe("adaptador ERP -> formato das telas", () => {
  const p = erpItemToShopifyProduct(presto);
  const [preto, black] = p.node.variants.edges.map((e) => e.node);
  it("mostra todas as cores, inclusive a ainda sem Shopify", () => {
    expect(p.node.options.find((o) => o.name === "Cor")?.values).toEqual(["Preto", "Preto Black"]);
  });
  it("preço do cadastro, sem preço 'de' inventado, vende sem estoque", () => {
    expect(black.price.amount).toBe("279.99");
    expect(black.compareAtPrice).toBeNull();
    expect(black.availableForSale).toBe(true);
    expect(black.quantityAvailable).toBe(0);
  });
  it("sem foto fica sem foto; com foto usa a do ERP", () => {
    expect(black.image).toBeNull();
    expect(preto.image?.url).toContain("fotos.servidorbanana.com");
  });
  it("marca a variação bipada", () => {
    expect(black.erp?.isHit).toBe(true);
    expect(preto.erp?.isHit).toBe(false);
  });
  it("item ligado mantém o id da Shopify e grava ERP + SKU pelo código de barras", () => {
    expect(orderItemIdentity(preto)).toEqual({ shopifyId: "gid://shopify/ProductVariant/111", sku: "789001", erp_variant_id: "v-preto-37", erp_master_id: "adc2e374" });
  });
  it("item só do ERP não leva id da Shopify (nenhum número que pareça variação)", () => {
    const id = orderItemIdentity(black);
    expect(id.shopifyId).toBe("");
    expect(id.sku).toBe("PB-37");
    expect(id.erp_variant_id).toBe("v-black-37");
  });
  it("produto da Shopify (sem ERP) grava como antes", () => {
    const v = { ...preto, erp: undefined };
    expect(orderItemIdentity(v)).toEqual({ shopifyId: "gid://shopify/ProductVariant/111", sku: "789001" });
  });
});

describe("pedido na Shopify ignora/avisa itens só do ERP", () => {
  it("detecta só itens do ERP sem id da Shopify; pedidos antigos não são afetados", () => {
    const items = [
      { title: "antigo", shopifyId: "gid://shopify/ProductVariant/5" },
      { title: "antigo sem id", shopifyId: "" },
      { title: "ligado", shopifyId: "gid://shopify/ProductVariant/6", erp_variant_id: "x" },
      { title: "só ERP", shopifyId: "", erp_variant_id: "y" },
    ];
    expect(erpOnlyItems(items).map((i) => i.title)).toEqual(["só ERP"]);
  });
});
