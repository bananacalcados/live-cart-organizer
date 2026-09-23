import { describe, it, expect } from "vitest";
import { buildSplitParts, rebalanceLastPart, validateSplit, splitCustomerTotal, describeSplit } from "@/lib/splitPayment";

describe("pagamento dividido", () => {
  it("desconto Pix só na parte Pix", () => {
    const parts = buildSplitParts([
      { method: "pix", amount: 200 },
      { method: "credit", amount: 260, installments: 6 },
    ]);
    expect(parts[0].charge_amount).toBe(190);
    expect(parts[1].charge_amount).toBe(260);
    expect(splitCustomerTotal(parts)).toBe(450);
    expect(describeSplit(parts)).toContain("em até 6x");
  });

  it("última parte cobre o restante", () => {
    const r = rebalanceLastPart(460, [{ method: "credit", amount: 150.33 }, { method: "debit", amount: 0 }]);
    expect(r[1].amount).toBe(309.67);
  });

  it("valida soma, mínimo de partes e parcelas", () => {
    expect(validateSplit(460, [{ method: "pix", amount: 200 }, { method: "credit", amount: 260 }]).ok).toBe(true);
    expect(validateSplit(460, [{ method: "pix", amount: 460 }]).ok).toBe(false);
    expect(validateSplit(460, [{ method: "pix", amount: 200 }, { method: "credit", amount: 250 }]).ok).toBe(false);
    expect(validateSplit(460, [{ method: "debit", amount: 200, installments: 2 }, { method: "credit", amount: 260 }]).ok).toBe(false);
    expect(validateSplit(100, [
      { method: "pix", amount: 20 }, { method: "pix", amount: 20 }, { method: "pix", amount: 20 },
      { method: "pix", amount: 20 }, { method: "pix", amount: 20 },
    ]).ok).toBe(false);
  });

  it("três partes cartão + cartão + pix", () => {
    const parts = buildSplitParts([
      { method: "credit", amount: 100, installments: 2 },
      { method: "debit", amount: 100 },
      { method: "pix", amount: 99.99 },
    ]);
    expect(parts[2].discount_amount).toBe(5);
    expect(splitCustomerTotal(parts)).toBe(294.99);
  });
});
