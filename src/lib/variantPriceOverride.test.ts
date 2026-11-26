import { describe, it, expect } from "vitest";
import { normalizeVariantOverride, splitOverridesOnParentChange } from "./variantPriceOverride";

describe("normalizeVariantOverride", () => {
  it("igual ao pai vira nulo", () => expect(normalizeVariantOverride("79.99", 79.99)).toBeNull());
  it("vazio ou 0 vira nulo", () => {
    expect(normalizeVariantOverride("", 79.99)).toBeNull();
    expect(normalizeVariantOverride(0, 79.99)).toBeNull();
  });
  it("diferente fica", () => expect(normalizeVariantOverride("89.99", 79.99)).toBe(89.99));
});

describe("splitOverridesOnParentChange", () => {
  it("separa quem tinha o preço antigo de quem tem preço próprio", () => {
    const r = splitOverridesOnParentChange(["79.99", "", "99.90", "79.99", "119.99"], 79.99, 119.99);
    expect(r.followOld).toEqual([0, 3]);
    expect(r.own).toEqual([{ index: 2, price: 99.9 }]);
  });
  it("sem mudança no pai não pergunta nada", () => {
    expect(splitOverridesOnParentChange(["79.99"], 79.99, 79.99).followOld).toEqual([]);
  });
});
