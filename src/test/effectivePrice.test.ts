import { describe, it, expect } from "vitest";
import { computeEffectiveUnitPrices } from "@/lib/pos/effectivePrice";

describe("computeEffectiveUnitPrices", () => {
  it("sem desconto → preços intactos", () => {
    const r = computeEffectiveUnitPrices(
      [{ unit_price: 200, quantity: 1 }, { unit_price: 100, quantity: 2 }],
      0,
    );
    expect(r.factor).toBe(1);
    expect(r.effective).toEqual([200, 100]);
  });

  it("rateia desconto proporcional (200 → 79,99)", () => {
    const r = computeEffectiveUnitPrices(
      [{ unit_price: 200, quantity: 1 }],
      120.01,
      79.99,
    );
    expect(r.effective[0]).toBeCloseTo(79.99, 2);
  });

  it("distribui desconto entre múltiplos itens e bate no total", () => {
    const items = [
      { unit_price: 100, quantity: 1 },
      { unit_price: 50, quantity: 2 },
    ];
    const r = computeEffectiveUnitPrices(items, 40, 160); // 200 - 40 = 160
    const total = r.effective.reduce((s, p, i) => s + p * items[i].quantity, 0);
    expect(Math.round(total * 100) / 100).toBe(160);
  });
});
