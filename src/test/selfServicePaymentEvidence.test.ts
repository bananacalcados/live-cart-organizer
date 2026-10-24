import { describe, it, expect } from "vitest";
import { capturedAustpayEvidence } from "../../supabase/functions/_shared/selfservice-payment-evidence";
describe("selfservice captured AustPay evidence", () => {
  it("accepts captured exact linked transaction when GET omits reference", () => {
    expect(capturedAustpayEvidence({ id: "tx", status: "APPROVED", approved_amount: 55998, approved_at: "2026-10-24T17:26:24Z" }, "tx", "order", "order")).toEqual({ amount: 559.98, paidAt: "2026-10-24T17:26:24Z" });
  });
  it("rejects conflicting reference", () => {
    expect(() => capturedAustpayEvidence({ id: "tx", status: "APPROVED", external_reference: "other" }, "tx", "order", "order")).toThrow();
  });
  it("rejects authorization without capture", () => {
    expect(() => capturedAustpayEvidence({ id: "tx", status: "AUTHORIZED" }, "tx", "order", "order")).toThrow();
  });
  it("rejects a different linked transaction", () => {
    expect(() => capturedAustpayEvidence({ id: "other", status: "APPROVED" }, "tx", "order", "order")).toThrow();
  });
});