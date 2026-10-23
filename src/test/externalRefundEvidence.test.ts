import { describe, expect, it } from "vitest";
import { externalRefundEvidence } from "../../supabase/functions/_shared/external-refund-evidence";

const row = {
  amount: 341.99,
  mp_response: { external_import: {
    payment_status: "refunded", payment_amount: 341.99,
    recipient_name: "Daiane Silva", recipient_cpf_masked: "***.607.798-**",
    displayed_datetime: "23/10/2026 21:08",
  } },
};

describe("external refund evidence", () => {
  it("uses the confirmed paid amount, not the 359.99 product price", () => {
    expect(externalRefundEvidence(row)?.paidAmount).toBe(341.99);
  });
  it("preserves the bank recipient independently of the purchase customer", () => {
    expect(externalRefundEvidence(row)?.recipientName).toBe("Daiane Silva");
    expect(externalRefundEvidence(row)?.recipientCpfMasked).toBe("***.607.798-**");
  });
  it("does not accept a refund larger than the verified payment", () => {
    expect(externalRefundEvidence({ ...row, amount: 342 })).toBeNull();
  });
  it("does not treat an unconfirmed payment as a completed external refund", () => {
    expect(externalRefundEvidence({ ...row, mp_response: { external_import: {
      ...row.mp_response.external_import, payment_status: "approved",
    } } })).toBeNull();
  });
});