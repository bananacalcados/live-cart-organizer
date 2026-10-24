import { describe, expect, it } from "vitest";
import { canPayRegisteredOrder, initialCartMode, selfServiceShipping } from "../lib/selfServiceCheckout";

describe("carrinho do autoatendimento", () => {
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