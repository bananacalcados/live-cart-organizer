import { describe, it, expect } from "vitest";
import { cashbackReachesMin } from "./saleCashback";
describe("cashback no carrinho do WhatsApp", () => {
  it("abaixo da compra mínima não abate", () => expect(cashbackReachesMin(154.85, 154.86)).toBe(false));
  it("no valor mínimo abate", () => expect(cashbackReachesMin(154.86, 154.86)).toBe(true));
});
