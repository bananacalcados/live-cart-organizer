import { describe, expect, it } from "vitest";
import { normalizePayerEmail, resolvePayerEmail } from "../../supabase/functions/_shared/payer-email";

describe("e-mail do pagador sem bloquear Pix por endereço inválido", () => {
  it("usa endereço técnico quando há ponto antes do @, sem adivinhar o e-mail real", () => {
    const original = "cliente.@hotmail.com";
    expect(normalizePayerEmail(original)).toBeNull();
    expect(resolvePayerEmail({ email: original, phone: "(33) 99999-0000" })).toEqual({
      email: "33999990000@cliente.bananacalcados.com.br", fallbackUsed: true, original,
    });
  });
  it.each([".cliente@gmail.com", "cli..ente@gmail.com", "cliente@-gmail.com", "cliente@gmail-.com", `${"a".repeat(65)}@gmail.com`])("rejeita estrutura inválida: %s", (email) => {
    expect(normalizePayerEmail(email)).toBeNull();
  });
  it("preserva endereço válido com pontos internos e alias", () => {
    expect(resolvePayerEmail({ email: "cliente.silva+pedido@hotmail.com" }).email).toBe("cliente.silva+pedido@hotmail.com");
  });
  it("preserva normalização de domínio existente", () => {
    expect(normalizePayerEmail(" Cliente@GMAIL.CON ")).toBe("cliente@gmail.com");
  });
  it("corrige o domínio gmail.coml recusado pelo Mercado Pago sem mudar a caixa postal", () => {
    const original = "cliente@gmail.coml";
    expect(resolvePayerEmail({ email: original })).toEqual({
      email: "cliente@gmail.com", fallbackUsed: true, original,
    });
  });
  it("usa o pedido exato quando telefone e CPF não estão disponíveis", () => {
    expect(resolvePayerEmail({ email: "cliente.@hotmail.com", orderId: "pedido-123" }).email).toBe("pedido123@cliente.bananacalcados.com.br");
  });
});