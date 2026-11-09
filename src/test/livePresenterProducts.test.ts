import { describe, expect, it } from "vitest";
import {
  buildBulkPresenterPatch,
  groupPresenterSizes,
  isPresenterSizeAllowed,
  presenterConditionsChanged,
  togglePresenterSize,
} from "@/lib/livePresenterProducts";

describe("numerações dos produtos da apresentadora", () => {
  it("produto antigo sem escolha mantém todas as numerações liberadas", () => {
    expect(isPresenterSizeAllowed(null, "37")).toBe(true);
    expect(isPresenterSizeAllowed(undefined, "37")).toBe(true);
  });

  it("desmarca uma numeração e volta para todas ao remarcar", () => {
    const without37 = togglePresenterSize(null, ["34", "35", "36", "37"], "37");
    expect(without37).toEqual(["34", "35", "36"]);
    expect(isPresenterSizeAllowed(without37, "37")).toBe(false);
    expect(togglePresenterSize(without37, ["34", "35", "36", "37"], "37")).toBeNull();
  });

  it("array vazio significa nenhuma numeração liberada", () => {
    expect(isPresenterSizeAllowed([], "34")).toBe(false);
  });

  it("agrupa e ordena por produto e cor, sem misturar outra cor", () => {
    const sizes = groupPresenterSizes([
      { master_id: "m1", color: "Preto", size: "38" },
      { master_id: "m1", color: "preto", size: "34" },
      { master_id: "m1", color: "Branco", size: "40" },
    ]);
    expect(sizes.get("m1|preto")).toEqual(["34", "38"]);
    expect(sizes.get("m1|branco")).toEqual(["40"]);
  });
});

describe("edição em grupo dos produtos preparados", () => {
  it("aplica preço 100 e frete grátis em uma única alteração", () => {
    expect(buildBulkPresenterPatch({ offerPrice: "100", freeShipping: "yes" }))
      .toEqual({ offer_price: 100, free_shipping: true });
  });

  it("campos não escolhidos não alteram o que já estava salvo", () => {
    expect(buildBulkPresenterPatch({ offerPrice: "", freeShipping: "keep" })).toEqual({});
    expect(buildBulkPresenterPatch({ offerPrice: "159,99", freeShipping: "no" }))
      .toEqual({ offer_price: 159.99, free_shipping: false });
  });

  it("não aceita preço inválido ou zerado", () => {
    expect(() => buildBulkPresenterPatch({ offerPrice: "0", freeShipping: "keep" })).toThrow();
    expect(() => buildBulkPresenterPatch({ offerPrice: "abc", freeShipping: "keep" })).toThrow();
  });

  it("não grava produto que já tem exatamente as condições escolhidas", () => {
    const row = { offer_price: 100, free_shipping: true };
    expect(presenterConditionsChanged(row, { offer_price: 100, free_shipping: true })).toBe(false);
    expect(presenterConditionsChanged(row, { offer_price: 100 })).toBe(false);
    expect(presenterConditionsChanged(row, { free_shipping: false })).toBe(true);
    expect(presenterConditionsChanged(row, { offer_price: 99.99 })).toBe(true);
  });
});
