import { describe, it, expect } from "vitest";
import { hasMissingProducts } from "./waitingFlag";

describe("tag Aguardando produto", () => {
  it("pedido de 1 produto já na Conferência não leva a tag", () => {
    expect(hasMissingProducts([{ quantity: 1, expedition_conference_qty: 1 }])).toBe(false);
  });
  it("pedido com parte faltando leva a tag", () => {
    expect(hasMissingProducts([
      { quantity: 1, expedition_conference_qty: 1 },
      { quantity: 2, expedition_conference_qty: 1 },
    ])).toBe(true);
  });
  it("tag sai quando o restante chega", () => {
    expect(hasMissingProducts([{ quantity: 2, expedition_conference_qty: 2 }])).toBe(false);
  });
});
