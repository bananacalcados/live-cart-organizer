import { describe, expect, it } from "vitest";
import { maskPhone, renderReceiptMessage, DEFAULT_RECEIPT_MESSAGE } from "@/lib/refundReceiptMessage";

const base = { nome: "Josiane", valor: 459.99, dataCompra: "2026-10-10T15:00:00Z", codigo: "HWBC22JN" };

describe("mensagem do comprovante de estorno", () => {
  it("cartão usa aviso de fatura", () => {
    const m = renderReceiptMessage(DEFAULT_RECEIPT_MESSAGE, { ...base, isPix: false });
    expect(m).toContain("Olá, Josiane!");
    expect(m).toContain("459,99");
    expect(m).toContain("10/10/2026");
    expect(m).toContain("fatura do cartão");
  });
  it("pix usa aviso de devolução E2E", () => {
    const m = renderReceiptMessage("", { ...base, isPix: true });
    expect(m).toContain("(E2E)");
    expect(m).not.toContain("fatura");
  });
  it("aceita {codigo}", () => {
    expect(renderReceiptMessage("cód {codigo}", { ...base, isPix: false })).toBe("cód HWBC22JN");
  });
  it("mascara telefone", () => {
    expect(maskPhone("5533999998888")).toBe("5533*****8888");
  });
});
