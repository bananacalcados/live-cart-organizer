import { describe, it, expect } from "vitest";
import { linesTotals, transferLabel, type TransferLine } from "./transferUtils";

const line = (q: number, stock: number): TransferLine => ({
  pos_product_id: crypto.randomUUID(), name: "X", size: "29", color: null, sku: "", barcode: "1",
  image_url: null, quantity: q, origin_stock: stock, dest_stock: 0,
});

describe("transferência de estoque", () => {
  it("bloqueia confirmar quando a quantidade passa do saldo da origem", () => {
    expect(linesTotals([line(1, 2), line(3, 2)]).hasError).toBe(true);
  });
  it("libera quando todas as quantidades cabem no saldo", () => {
    expect(linesTotals([line(2, 2), line(1, 5)])).toEqual({ count: 2, pairs: 3, hasError: false });
  });
  it("numera como T-000123", () => {
    expect(transferLabel(123)).toBe("T-000123");
  });
});
