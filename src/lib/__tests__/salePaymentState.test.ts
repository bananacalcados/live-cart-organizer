import { describe, it, expect } from "vitest";
import { getSalePaymentState } from "../salePaymentState";
describe("getSalePaymentState", () => {
  it("cancelada já paga = refunded", () => expect(getSalePaymentState({ status: "cancelled", paid_at: "2026-11-01" })).toBe("refunded"));
  it("cancelada sem pagamento = unpaid", () => expect(getSalePaymentState({ status: "cancelled", paid_at: null })).toBe("unpaid"));
  it("paga = paid", () => expect(getSalePaymentState({ status: "paid", paid_at: "x" })).toBe("paid"));
});
