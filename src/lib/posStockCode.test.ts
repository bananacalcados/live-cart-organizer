import { describe, it, expect, vi, beforeEach } from "vitest";
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: any[]) => rpc(...a) } }));
import { resolvePosNewCode, findSaleItemIndexForResolvedCode } from "./posStockCode";

const base = { variant_id: "v", code: "T101-37", variant_sku: "VSKU", variant_gtin: "7890000000017", color: null, size: "37",
  master_name: "Tênis", pos_product_id: "p1", tiny_id: 10, product_name: "Tênis", product_variant: "37",
  product_sku: "SKU37", product_barcode: "7891234567895", stock: 2 };

beforeEach(() => rpc.mockReset());

describe("código novo no PDV", () => {
  it("resolve para o EAN do cadastro da loja (mesma busca do EAN)", async () => {
    rpc.mockResolvedValue({ data: [base], error: null });
    const r = await resolvePosNewCode("T101-37", "s1");
    expect(rpc).toHaveBeenCalledWith("resolve_stock_code", { p_code: "T101-37", p_store_id: "s1" });
    expect(r).toMatchObject({ kind: "found", lookup: "7891234567895" });
  });
  it("usa SKU quando não há EAN", async () => {
    rpc.mockResolvedValue({ data: [{ ...base, product_barcode: null }], error: null });
    expect(await resolvePosNewCode("T101-37", "s1")).toMatchObject({ kind: "found", lookup: "SKU37" });
  });
  it("variação sem cadastro na loja não adiciona", async () => {
    rpc.mockResolvedValue({ data: [{ ...base, pos_product_id: null, product_barcode: null, product_sku: null }], error: null });
    expect((await resolvePosNewCode("T101-37", "s1")).kind).toBe("no_store_product");
  });
  it("código inexistente = não encontrado", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await resolvePosNewCode("B048-U", "s1")).kind).toBe("not_found");
  });
  it("EAN/SKU/nome comum não chama a busca nova", async () => {
    for (const c of ["7891234567895", "SKU37", "tenis azul", "T101"]) {
      expect((await resolvePosNewCode(c, "s1")).kind).toBe("not_new_code");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("código novo na conferência", () => {
  const items = [
    { sku: "OUTRO", barcode: "111", scanned: false },
    { sku: "SKU37", barcode: "7891234567895", scanned: false },
  ];
  it("confere o item certo", () => {
    expect(findSaleItemIndexForResolvedCode(items, base)).toBe(1);
  });
  it("casa pelo GTIN da variação", () => {
    expect(findSaleItemIndexForResolvedCode([{ sku: "", barcode: "7890000000017" }], base)).toBe(0);
  });
  it("produto fora da venda não casa", () => {
    expect(findSaleItemIndexForResolvedCode([{ sku: "X", barcode: "Y" }], base)).toBe(-1);
  });
  it("item já conferido não casa de novo", () => {
    expect(findSaleItemIndexForResolvedCode([{ ...items[1], scanned: true }], base)).toBe(-1);
  });
});
