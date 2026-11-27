import { beforeEach, describe, expect, it, vi } from "vitest";
import { looksLikeStockCode, searchMasters } from "./data";

const { rpc, from, select, or, order, limit } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  or: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from },
}));

const exact = {
  master_id: "82a03908-d46f-4a3e-b4a5-ddf365a400b7",
  variant_id: "63c2f96f-0000-4000-8000-000000000000",
  code: "T176-37",
  color: "Bege",
  size: "37",
  master_name: "TENIS FEMININO NEW BALANCE 9060 BEATRIZ",
  sku_root: "100248",
  matched_by: "etiqueta_interna",
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [], error: null });
  limit.mockResolvedValue({ data: [], error: null });
  order.mockReturnValue({ limit });
  or.mockReturnValue({ order });
  select.mockReturnValue({ or });
  from.mockReturnValue({ select });
});

describe("busca inicial do estoque mobile", () => {
  it.each([
    ["T176-37", "etiqueta interna"],
    ["  t176-37 ", "etiqueta interna curta em minúsculas"],
    ["7898155760299", "GTIN"],
    ["100248-BEGE-37", "SKU da variação"],
    ["100248", "SKU do pai"],
    ["T1-37", "código interno curto"],
  ])("reconhece %s como %s antes de buscar por nome", async (code) => {
    rpc.mockResolvedValue({ data: [{ ...exact, code: code.trim() }], error: null });
    const result = await searchMasters(code);
    expect(result).toEqual({
      hits: [],
      exactMasterId: exact.master_id,
      exactVariantId: exact.variant_id,
    });
    expect(rpc).toHaveBeenCalledWith("mobile_resolve_product_code", { p_code: code.trim() });
    expect(from).not.toHaveBeenCalled();
  });

  it("informa código inexistente depois de não achar código nem nome", async () => {
    const result = await searchMasters("T999-99");
    expect(result).toEqual({ hits: [], notFoundCode: "T999-99" });
    expect(from).toHaveBeenCalledWith("products_master");
  });

  it("na câmera não transforma código desconhecido em busca por nome", async () => {
    const result = await searchMasters(" T999-99 ", { codeOnly: true });
    expect(result).toEqual({ hits: [], notFoundCode: "T999-99" });
    expect(from).not.toHaveBeenCalled();
  });

  it("mantém busca normal por nome quando o texto não é código", async () => {
    limit.mockResolvedValue({ data: [{ id: "m1", name: "New Balance", sku_root: "100248", sale_price: 299.99 }], error: null });
    const result = await searchMasters("New Balance");
    expect(result.hits).toHaveLength(1);
    expect(result.notFoundCode).toBeUndefined();
  });

  it("não exige seis caracteres para reconhecer formato de código", () => {
    expect(looksLikeStockCode("T1-37")).toBe(true);
    expect(looksLikeStockCode("37")).toBe(true);
    expect(looksLikeStockCode("New Balance")).toBe(false);
  });
});
