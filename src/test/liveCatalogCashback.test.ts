import { describe, it, expect } from "vitest";
import { computeCatalogCashback, yourPrice } from "../../supabase/functions/live-catalog/cashback";

const coupon = { id: "c1", cashback_amount: 50, min_purchase: 100 };

describe("cashback do catálogo", () => {
  it("item promocional não conta para o cashback", () => {
    const r = computeCatalogCashback([{ price: 199.99, quantity: 1, promo: true }], coupon);
    expect(r.amount).toBe(0);
    expect(r.cashback_id).toBeNull();
  });
  it("só aplica quando o elegível atinge a compra mínima", () => {
    expect(computeCatalogCashback([{ price: 99.99, quantity: 1 }], coupon)).toMatchObject({ amount: 0, min_purchase_hint: 100 });
    expect(computeCatalogCashback([{ price: 100, quantity: 1 }], coupon)).toMatchObject({ amount: 50, cashback_id: "c1" });
  });
  it("abatimento nunca passa do valor elegível", () => {
    const r = computeCatalogCashback([{ price: 30, quantity: 1 }], { id: "c", cashback_amount: 80, min_purchase: 0 });
    expect(r.amount).toBe(30);
  });
  it("ao remover o item normal, o cashback sai", () => {
    const items = [{ price: 159.99, quantity: 1 }, { price: 199.99, quantity: 1, promo: true }];
    expect(computeCatalogCashback(items, coupon).amount).toBe(50);
    expect(computeCatalogCashback(items.slice(1), coupon).amount).toBe(0);
  });
  it("preço com cashback usa só o saldo ainda não usado; promo mantém o preço", () => {
    expect(yourPrice(159.99, false, coupon, 0)).toEqual({ your_price: 109.99, cashback_discount: 50 });
    expect(yourPrice(159.99, false, coupon, 50)).toEqual({ your_price: 159.99, cashback_discount: 0 });
    expect(yourPrice(199.99, true, coupon, 0)).toEqual({ your_price: 199.99, cashback_discount: 0 });
  });
});
