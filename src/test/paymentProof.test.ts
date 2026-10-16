import { describe, expect, it } from "vitest";
import { cachedPaymentResponse, validAustpayPaymentProof } from "../../supabase/functions/_shared/payment-proof";

const proof = {
  environment: "production", responseOk: true, transactionId: "real-tx", expectedTransactionId: "real-tx",
  reference: "order", expectedReference: "order", status: "APPROVED", amountCents: 35999, expectedAmountCents: 35999,
};
describe("comprovação real de pagamento", () => {
  it("aceita pagamento capturado de produção com valor e pedido corretos", () => {
    expect(validAustpayPaymentProof(proof)).toBe(true);
  });
  it("nunca aceita aprovação sandbox como pagamento real", () => {
    expect(validAustpayPaymentProof({ ...proof, environment: "sandbox" })).toBe(false);
  });
  it("não usa webhook quando a operadora não confirma", () => {
    expect(validAustpayPaymentProof({ ...proof, responseOk: false })).toBe(false);
  });
  it("não confunde autorização com pagamento capturado", () => {
    expect(validAustpayPaymentProof({ ...proof, status: "AUTHORIZED" })).toBe(false);
  });
  it("exige valor exato", () => {
    expect(validAustpayPaymentProof({ ...proof, amountCents: 35998 })).toBe(false);
  });
  it("exige referência do pedido", () => {
    expect(validAustpayPaymentProof({ ...proof, reference: "other-order" })).toBe(false);
  });
  it("exige transação exata", () => {
    expect(validAustpayPaymentProof({ ...proof, transactionId: "old-tx" })).toBe(false);
  });
  it("registro antigo não devolve sucesso nem permite nova cobrança", () => {
    const result = cachedPaymentResponse("austpay");
    expect(result.success).toBe(false);
    expect(result.already_processing).toBe(true);
    expect(result.pending).toBe(true);
  });
});