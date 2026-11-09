import { describe, expect, it } from "vitest";
import { labelOfferPrice } from "@/lib/productCodeLabels";

describe("etiqueta de código com oferta da apresentadora", () => {
  it("mostra R$ 199,90 cheio e R$ 149,90 promocional quando configurado", () => {
    expect(labelOfferPrice({ sale_price: 199.9, offer_price: 149.9 })).toBe(149.9);
  });

  it("não trata preço igual ou maior como desconto", () => {
    expect(labelOfferPrice({ sale_price: 199.9, offer_price: 199.9 })).toBeNull();
    expect(labelOfferPrice({ sale_price: 199.9, offer_price: 219.9 })).toBeNull();
  });

  it("mantém somente o preço cheio quando não há oferta", () => {
    expect(labelOfferPrice({ sale_price: 199.9, offer_price: null })).toBeNull();
    expect(labelOfferPrice({ sale_price: 199.9 })).toBeNull();
  });
});
