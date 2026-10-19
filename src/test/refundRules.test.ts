import { describe, expect, it } from "vitest";
import {
  confirmationAmountMatches,
  isWithinRefundWindow,
  MAX_REFUND_AGE_DAYS,
  needsApproval,
  refundRemaining,
  validateRefundAmount,
} from "@/lib/refundRules";

describe("refundRemaining", () => {
  it("devolve o valor ainda não estornado", () => {
    expect(refundRemaining(341.99, 0)).toBe(341.99);
    expect(refundRemaining(341.99, 100)).toBe(241.99);
    expect(refundRemaining(100, 100)).toBe(0);
    expect(refundRemaining(100, 150)).toBe(0);
  });
});

describe("isWithinRefundWindow", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  it("aceita pagamento aprovado há 179 dias", () => {
    const d = new Date(now.getTime() - 179 * 24 * 60 * 60 * 1000);
    expect(isWithinRefundWindow(d, now)).toBe(true);
  });
  it("recusa pagamento aprovado há mais de 180 dias", () => {
    const d = new Date(now.getTime() - (MAX_REFUND_AGE_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(isWithinRefundWindow(d, now)).toBe(false);
  });
  it("sem data de aprovação não bloqueia no front", () => {
    expect(isWithinRefundWindow(null, now)).toBe(true);
  });
});

describe("needsApproval", () => {
  it("admin nunca precisa de aprovação", () => {
    expect(needsApproval(true, null, 10000)).toBe(false);
    expect(needsApproval(true, 100, 5000)).toBe(false);
  });
  it("sem teto configurado, não-admin sempre aguarda aprovação", () => {
    expect(needsApproval(false, null, 1)).toBe(true);
    expect(needsApproval(false, null, 500)).toBe(true);
  });
  it("com teto, só valores acima aguardam aprovação", () => {
    expect(needsApproval(false, 200, 200)).toBe(false);
    expect(needsApproval(false, 200, 200.01)).toBe(true);
    expect(needsApproval(false, 200, 50)).toBe(false);
  });
});

describe("validateRefundAmount", () => {
  it("recusa zero, negativo e NaN", () => {
    expect(validateRefundAmount(0, 100)).toBeTruthy();
    expect(validateRefundAmount(-5, 100)).toBeTruthy();
    expect(validateRefundAmount(Number.NaN, 100)).toBeTruthy();
  });
  it("recusa valor maior que o restante", () => {
    expect(validateRefundAmount(100.01, 100)).toBeTruthy();
  });
  it("aceita valor igual ou menor que o restante", () => {
    expect(validateRefundAmount(100, 100)).toBeNull();
    expect(validateRefundAmount(50, 100)).toBeNull();
  });
});

describe("confirmationAmountMatches", () => {
  it("exige o valor exato digitado na confirmação", () => {
    expect(confirmationAmountMatches(341.99, 341.99)).toBe(true);
    expect(confirmationAmountMatches(341.98, 341.99)).toBe(false);
    expect(confirmationAmountMatches(0, 341.99)).toBe(false);
  });
});
