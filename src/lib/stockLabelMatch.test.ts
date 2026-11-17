import { describe, expect, it } from "vitest";
import { itemMatchesResolvedStockLabel, resolvedStockLabelCodes } from "./stockLabelMatch";
import type { ResolvedStockCode } from "./inventoryStockCode";

const resolved: ResolvedStockCode = {
  variant_id: "v1", code: "T101-37", variant_sku: "VSKU37", variant_gtin: "7890000000017",
  color: "Preto", size: "37", master_name: "Tênis", pos_product_id: "p1", tiny_id: 10,
  product_name: "Tênis", product_variant: "Preto / 37", product_sku: "SKU37",
  product_barcode: "7891234567895", stock: 2,
};

describe("códigos representados pela etiqueta nova", () => {
  it("devolve EAN/SKU do produto e da variação, sem vazios nem repetição", () => {
    expect(resolvedStockLabelCodes({ ...resolved, variant_gtin: resolved.product_barcode, variant_sku: null })).toEqual([
      "7891234567895", "sku37",
    ]);
  });

  it("casa por qualquer EAN/SKU sem diferenciar maiúsculas", () => {
    expect(itemMatchesResolvedStockLabel({ sku: "vsku37", barcode: null }, resolved)).toBe(true);
    expect(itemMatchesResolvedStockLabel({ sku: null, barcodes: ["OUTRO", "7890000000017"] }, resolved)).toBe(true);
    expect(itemMatchesResolvedStockLabel({ sku: "OUTRO", barcode: "123" }, resolved)).toBe(false);
  });
});
