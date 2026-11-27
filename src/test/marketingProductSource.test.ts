import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchProducts = vi.fn(async (..._a: unknown[]) => [] as any[]);
const rpc = vi.fn();
const invoke = vi.fn();
let stored: unknown = "shopify";
vi.mock("@/lib/shopify", () => ({ fetchProducts: (...a: unknown[]) => fetchProducts(...a) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...a: unknown[]) => rpc(...a),
  functions: { invoke: (...a: unknown[]) => invoke(...a) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: stored } }) }) }) }),
} }));

import { __resetProductSource, type ErpCatalogItem } from "@/lib/liveProductSource";
import { erpMasterFromId, erpProductWhatsAppUrl, fetchMarketingProducts, fetchPublicErpProducts } from "@/lib/marketing/erpMarketing";

const M = "11111111-2222-3333-4444-555555555555";
const linked = "99999999-2222-3333-4444-555555555555";
const item = (id: string, shop: string | null): ErpCatalogItem => ({
  master_id: id, name: "Tênis", description: null, category: null, brand: null, sale_price: 199.9,
  shopify_product_id: shop, hit_variant_id: null,
  variants: [{ variant_id: "v1", sku: "S1", gtin: null, color: "Preto", size: "37", price: 199.9, shopify_variant_id: shop ? "7" : null, live_code: null, image: null, image_source: null, stock_perola: 2 }],
});

beforeEach(() => { fetchProducts.mockReset(); fetchProducts.mockResolvedValue([]); rpc.mockReset(); invoke.mockReset(); __resetProductSource("product_source_marketing"); });

describe("interruptor product_source_marketing", () => {
  it("'shopify' chama a Shopify exatamente como antes", async () => {
    stored = "shopify";
    await fetchMarketingProducts(250, undefined, { newestFirst: true });
    expect(fetchProducts).toHaveBeenCalledWith(250, undefined, { newestFirst: true });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("'erp' busca no ERP; produto ligado recebe o endereço do site, só do ERP fica sem", async () => {
    __resetProductSource("product_source_marketing", "erp");
    rpc.mockResolvedValue({ data: { total: 2, items: [item(M, null), item(linked, "5")] }, error: null });
    fetchProducts.mockResolvedValue([{ node: { id: "gid://shopify/Product/5", handle: "tenis-x" } }]);
    const r = await fetchMarketingProducts(50, "tenis");
    expect(r[0].node.id).toBe(`erp-product:${M}`);
    expect(r[0].node.handle).toBe("");
    expect(r[1].node.handle).toBe("tenis-x");
    expect(fetchProducts).toHaveBeenCalledWith(1, "id:5");
  });
});

describe("páginas públicas", () => {
  it("página antiga (só ids da Shopify) não faz consulta extra", async () => {
    expect(await fetchPublicErpProducts(["gid://shopify/Product/1"])).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("id do ERP vira produto com id do ERP; sem estoque não aparece como disponível", async () => {
    invoke.mockResolvedValue({ data: { items: [{ ...item(M, null), variants: [{ ...item(M, null).variants[0], in_stock: false }] }] }, error: null });
    const [p] = await fetchPublicErpProducts([`erp-product:${M}`]);
    expect(p.node.id).toBe(`erp-product:${M}`);
    expect(p.node.variants.edges[0].node.availableForSale).toBe(false);
    expect(p.node.variants.edges[0].node.compareAtPrice).toBeNull();
  });
  it("destino do clique de produto só do ERP é o WhatsApp de atendimento (vip-go)", () => {
    expect(erpMasterFromId(`erp-product:${M}`)).toBe(M);
    expect(erpMasterFromId("gid://shopify/Product/1")).toBeNull();
    expect(erpProductWhatsAppUrl(M, "Preto")).toMatch(new RegExp(`/functions/v1/vip-go\\?p=${M}&cor=Preto$`));
  });
});
