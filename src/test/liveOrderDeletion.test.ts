import { describe, expect, it } from "vitest";
import { orderHasGeneratedCharge, PENDING_CHARGE_DELETE_MESSAGE } from "@/lib/liveOrderDeletion";

describe("exclusão de pedido com cobrança", () => {
  it("bloqueia cada identificador de cobrança e também uma divisão pendente", () => {
    for (const field of ["mercadopago_payment_id", "pagarme_order_id", "vindi_transaction_id", "appmax_order_id", "austpay_transaction_id", "gateway_snapshot"] as const) {
      expect(orderHasGeneratedCharge({ is_paid: false, [field]: field === "gateway_snapshot" ? { at: "2026-11-16" } : "123" })).toBe(true);
    }
    expect(orderHasGeneratedCharge({ is_paid: false }, 1)).toBe(true);
    expect(PENDING_CHARGE_DELETE_MESSAGE).toContain("cancele o pedido ou mescle");
  });
  it("não bloqueia pedido pago nem pedido sem cobrança", () => {
    expect(orderHasGeneratedCharge({ is_paid: true, mercadopago_payment_id: "123" })).toBe(false);
    expect(orderHasGeneratedCharge({ is_paid: false })).toBe(false);
  });
});
