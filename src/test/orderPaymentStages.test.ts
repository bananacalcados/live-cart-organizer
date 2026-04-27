import { describe, expect, it } from "vitest";
import { isOrderMarkedPaid, isPaidOrderStage, paidOrderStages } from "@/lib/orderPaymentStages";

describe("orderPaymentStages", () => {
  it("trata todas as etapas logísticas pagas como faturamento recebido", () => {
    expect(paidOrderStages).toEqual([
      "paid",
      "awaiting_shipping",
      "awaiting_mototaxi",
      "awaiting_pickup",
      "shipped",
      "completed",
    ]);

    for (const stage of paidOrderStages) {
      expect(isPaidOrderStage(stage)).toBe(true);
      expect(isOrderMarkedPaid({ stage, is_paid: false, paid_externally: false })).toBe(true);
    }
  });

  it("não marca etapas pré-pagamento como pagas", () => {
    expect(isPaidOrderStage("awaiting_payment")).toBe(false);
    expect(isOrderMarkedPaid({ stage: "awaiting_payment", is_paid: false, paid_externally: false })).toBe(false);
  });
});