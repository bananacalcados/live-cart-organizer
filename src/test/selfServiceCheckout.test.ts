import { describe, expect, it } from "vitest";
import { canFillSelfServiceRegistration, canPayRegisteredOrder, initialCartMode, selfServiceShipping } from "../lib/selfServiceCheckout";

describe("carrinho do autoatendimento", () => {
  it("abre os dados junto ao pedido sem transformar telefone digitado em confirmação", () => {
    expect(canFillSelfServiceRegistration(true, false, false)).toBe(true);
    expect(canPayRegisteredOrder({ id: "pedido", registered_at: null, registration_confirmed: false })).toBe(false);
  });
  it("permite cadastro sem pedido", () => {
    expect(canFillSelfServiceRegistration(false, false, false)).toBe(true);
  });
  it("não solicita novo cadastro de pedido confirmado", () => {
    expect(canFillSelfServiceRegistration(true, true, false)).toBe(false);
  });
  it("mantém o bloqueio de reserva expirada", () => {
    expect(canFillSelfServiceRegistration(true, false, true)).toBe(false);
  });
  it("cadastro confirmado no WhatsApp não exige nova confirmação", () => {
    expect(canPayRegisteredOrder({ id: "pedido", registered_at: "2026-10-24T15:57:02Z", registration_confirmed: true })).toBe(true);
    expect(canPayRegisteredOrder({ id: "pedido", registered_at: "2026-10-24T15:57:02Z", registration_confirmed: false })).toBe(false);
  });
  it("exibe o frete do pedido sem cobrar frete marcado como grátis", () => {
    expect(selfServiceShipping({ id: "pedido", shipping_cost: 19.99, free_shipping: false })).toBe(19.99);
    expect(selfServiceShipping({ id: "pedido", shipping_cost: 19.99, free_shipping: true })).toBe(0);
  });
  it("link da equipe com ?pgto=cartao abre direto na tela do cartão", () => {
    expect(initialCartMode("?pgto=cartao")).toBe("card");
  });
  it.each(["", "?pgto=pix", "?pgto=cartao2"])("link sem o parâmetro (%s) mantém a tela de escolha", (search) => {
    expect(initialCartMode(search)).toBe("choose");
  });
});