import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { erpCardCaption, erpColorCards, resolveSendableImage, whatsappSendCandidates } from "@/lib/whatsapp/erpProductPhotos";
import type { ErpCatalogItem } from "@/lib/liveProductSource";

const item: ErpCatalogItem = {
  master_id: "m1", name: "Tamanco Nuvem", description: null, category: null, brand: "B Confort", sale_price: 99.9,
  shopify_product_id: null, hit_variant_id: null,
  variants: [
    { variant_id: "a", sku: "S1", gtin: "1", color: "Preto", size: "36", price: 99.9, shopify_variant_id: null, live_code: "T1", image: "https://fotos.servidorbanana.com/f/08/abc_m.webp", image_source: "erp", stock_perola: 1 },
    { variant_id: "b", sku: "S2", gtin: "2", color: "Preto", size: "34", price: 99.9, shopify_variant_id: null, live_code: "T1", image: "https://fotos.servidorbanana.com/f/08/abc_m.webp", image_source: "erp", stock_perola: 0 },
    { variant_id: "c", sku: "S3", gtin: "3", color: "Bege", size: "35", price: 99.9, shopify_variant_id: null, live_code: "T2", image: null, image_source: null, stock_perola: 0 },
  ],
};
const head = (ok: Record<string, string>) => (async (u: string) => ({ ok: !!ok[u], headers: { get: () => ok[u] || "" } })) as unknown as typeof fetch;

describe("WhatsApp com produtos do ERP", () => {
  it("um cartão por cor, com todas as cores ativas e tamanhos em ordem", () => {
    const cards = erpColorCards([item]);
    expect(cards.map((c) => c.color)).toEqual(["Preto", "Bege"]);
    expect(cards[0].sizes).toEqual(["34", "36"]);
    expect(cards[1].image).toBeNull();
  });
  it("texto sem foto tem nome, cor, tamanhos e preço", () => {
    const t = erpCardCaption(erpColorCards([item])[1]);
    expect(t).toContain("Tamanco Nuvem"); expect(t).toContain("Bege"); expect(t).toContain("35"); expect(t).toContain("99,90");
  });
  it("prefere o JPG do mesmo arquivo; Meta nunca recebe WebP", async () => {
    const u = "https://fotos.servidorbanana.com/f/08/abc_m.webp";
    expect(whatsappSendCandidates(u)[0]).toBe("https://fotos.servidorbanana.com/f/08/abc_g.jpg");
    expect(await resolveSendableImage(u, "meta", head({ "https://fotos.servidorbanana.com/f/08/abc_g.jpg": "image/jpeg" }))).toMatch(/_g\.jpg$/);
    expect(await resolveSendableImage(u, "meta", head({ [u]: "image/webp" }))).toBeNull();
    expect(await resolveSendableImage(u, "uazapi", head({ [u]: "image/webp" }))).toBe(u);
  });
  it("foto que não abre não é enviada (vira só texto)", async () => {
    expect(await resolveSendableImage("https://x/y.jpg", "uazapi", head({}))).toBeNull();
    expect(await resolveSendableImage(null, "uazapi", head({}))).toBeNull();
  });
});
