import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const sendMedia = vi.fn(async () => "mid-1");
const sendText = vi.fn(async () => "mid-2");
const insert = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/pos/posWhatsappSend", () => ({ posSendMedia: (...a: unknown[]) => sendMedia(...(a as [])), posSendText: (...a: unknown[]) => sendText(...(a as [])) }));
vi.mock("@/integrations/supabase/client", () => {
  const q: any = { select: () => q, eq: () => q, in: () => q, limit: async () => ({ data: [] }), maybeSingle: async () => ({ data: null }), insert: (...a: unknown[]) => insert(...(a as [])) };
  return { supabase: { from: () => q } };
});
vi.mock("@/lib/liveProductSource", () => ({
  getProductSource: async () => "erp",
  searchErpCatalog: async () => ({ total: 1, products: [], items: [{
    master_id: "m1", name: "Tamanco Nuvem", description: null, category: null, brand: null, sale_price: 99.9, shopify_product_id: null, hit_variant_id: null,
    variants: [
      { variant_id: "a", sku: "S1", gtin: "1", color: "Preto", size: "36", price: 99.9, shopify_variant_id: null, live_code: "T1", image: "https://fotos.servidorbanana.com/f/08/abc_m.webp", image_source: "erp", stock_perola: 1 },
      { variant_id: "c", sku: "S3", gtin: "3", color: "Bege", size: "35", price: 99.9, shopify_variant_id: null, live_code: "T2", image: null, image_source: null, stock_perola: 0 },
    ] }] }),
}));
vi.mock("@/lib/shopify", () => ({ fetchProducts: vi.fn() }));
vi.mock("@/components/chat/EmbeddedDialog", () => ({ EmbeddedDialog: ({ children }: any) => <div>{children}</div>, EmbeddedDialogContent: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ui/dialog", () => ({ DialogHeader: ({ children }: any) => <div>{children}</div>, DialogTitle: ({ children }: any) => <div>{children}</div> }));

import { POSProductCatalogSender } from "@/components/pos/POSProductCatalogSender";

describe("catálogo do WhatsApp com produto só do ERP (envio simulado)", () => {
  it("várias cores de uma vez: com foto vai imagem JPG, sem foto vai só texto", async () => {
    globalThis.fetch = vi.fn(async (u: string) => ({ ok: String(u).endsWith("_g.jpg"), headers: { get: () => "image/jpeg" } })) as any;
    render(<POSProductCatalogSender storeId="s" phone="5533000000000" sendVia="uazapi" selectedNumberId="n1" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Tamanco Nuvem")).toHaveLength(2));
    expect(screen.getByText(/sem foto/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Selecionar todos/ }));
    fireEvent.click(screen.getByRole("button", { name: /Enviar \(2\)/ }));
    await waitFor(() => expect(sendText).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(sendMedia).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: "https://fotos.servidorbanana.com/f/08/abc_g.jpg", mediaType: "image" }));
    expect((sendText.mock.calls[0] as any)[0].message).toContain("Bege");
  });
});
