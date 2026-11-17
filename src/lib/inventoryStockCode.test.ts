import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addResolvedStockCodeToCount,
  findCountedItemByScannedCode,
  incrementInventoryCountItem,
  isNewStockLabelCode,
  resolveStockLabelCode,
  stockCodeCloneLookup,
  type InventoryStockCountItem,
  type ResolvedStockCode,
} from "./inventoryStockCode";

const { rpc, from, insert, update, eq } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from },
}));

const resolvedProduct: ResolvedStockCode = {
  variant_id: "variant-1",
  code: "T101-37",
  variant_sku: "T101-37-SKU",
  variant_gtin: "7891234567890",
  color: "Azul",
  size: "37",
  master_name: "Tênis Conforto",
  pos_product_id: "pos-1",
  tiny_id: 101,
  product_name: "Tênis Conforto",
  product_variant: "Azul / 37",
  product_sku: "TENIS-37",
  product_barcode: "7891234567890",
  stock: 4,
};

const countedItem = (overrides: Partial<InventoryStockCountItem> = {}): InventoryStockCountItem => ({
  id: "item-1",
  product_id: "101",
  product_name: "Tênis Conforto - Azul / 37",
  sku: "TENIS-37",
  barcode: "7891234567890",
  counted_quantity: 1,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [resolvedProduct], error: null });
  insert.mockResolvedValue({ error: null });
  eq.mockResolvedValue({ error: null });
  update.mockReturnValue({ eq });
  from.mockReturnValue({ insert, update });
});

describe("código novo da etiqueta no balanço", () => {
  it("aceita os formatos novos e rejeita EAN de 13 dígitos", () => {
    for (const code of ["T101-37", "B048-U", "T101-3334", "T101-37.2", "t101-37"]) {
      expect(isNewStockLabelCode(code)).toBe(true);
    }
    expect(isNewStockLabelCode("7891234567890")).toBe(false);
    expect(isNewStockLabelCode("T10137")).toBe(false);
  });

  it("resolve um código com cadastro e grava EAN/SKU do produto", async () => {
    const resolved = await resolveStockLabelCode("T101-37", "store-1");
    expect(rpc).toHaveBeenCalledWith("resolve_stock_code", { p_code: "T101-37", p_store_id: "store-1" });
    const result = await addResolvedStockCodeToCount("count-1", [], resolved!, 2);
    expect(result).toMatchObject({ quantity: 2, inserted: true, error: null });
    expect(insert).toHaveBeenCalledWith({
      count_id: "count-1",
      product_id: "101",
      product_name: "Tênis Conforto - Azul / 37",
      sku: "TENIS-37",
      barcode: "7891234567890",
      counted_quantity: 2,
    });
  });

  it("soma a repetição do mesmo código no item já contado", async () => {
    const result = await addResolvedStockCodeToCount("count-1", [countedItem({ counted_quantity: 2 })], resolvedProduct, 1);
    expect(result).toMatchObject({ quantity: 3, inserted: false, error: null });
    expect(update).toHaveBeenCalledWith({ counted_quantity: 3 });
    expect(eq).toHaveBeenCalledWith("id", "item-1");
    expect(insert).not.toHaveBeenCalled();
  });

  it("bipa o código novo e depois o EAN somando no mesmo item", async () => {
    await addResolvedStockCodeToCount("count-1", [], resolvedProduct, 1);
    const inserted = insert.mock.calls[0][0];
    const item = countedItem({ ...inserted, id: "item-1", counted_quantity: 1 });
    const existingByEan = findCountedItemByScannedCode([item], "7891234567890");
    expect(existingByEan?.id).toBe("item-1");
    const result = await incrementInventoryCountItem(existingByEan!, 1);
    expect(result).toEqual({ quantity: 2, error: null });
    expect(update).toHaveBeenCalledWith({ counted_quantity: 2 });
    expect(eq).toHaveBeenCalledWith("id", "item-1");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("usa o GTIN da variação para clonar quando não há cadastro na loja", async () => {
    const withoutProduct = { ...resolvedProduct, pos_product_id: null, tiny_id: null };
    rpc.mockResolvedValue({ data: [withoutProduct], error: null });
    const resolved = await resolveStockLabelCode("B048-U", "store-1");
    expect(resolved?.pos_product_id).toBeNull();
    expect(stockCodeCloneLookup(resolved, "B048-U")).toBe("7891234567890");
    expect(from).not.toHaveBeenCalled();
  });

  it("mantém o código original quando a variação não tem GTIN nem SKU", () => {
    const withoutCodes = { ...resolvedProduct, pos_product_id: null, variant_gtin: null, variant_sku: null };
    expect(stockCodeCloneLookup(withoutCodes, "B048-U")).toBe("B048-U");
  });

  it("segue o fluxo atual quando o código não existe", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const resolved = await resolveStockLabelCode("T101-99", "store-1");
    expect(resolved).toBeNull();
    expect(stockCodeCloneLookup(resolved, "T101-99")).toBe("T101-99");
    expect(from).not.toHaveBeenCalled();
  });

  it("não chama a busca nova para um EAN comum", async () => {
    expect(await resolveStockLabelCode("7891234567890", "store-1")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
