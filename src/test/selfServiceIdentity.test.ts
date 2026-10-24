import { describe, expect, it } from "vitest";
import { orderInstagram, selfservicePhoneKey } from "../../supabase/functions/_shared/selfservice-identity";

describe("identidade da confirmação da live", () => {
  it("usa mattaguiar2 do pedido e não luisa_offs da mesma linha telefônica", () => {
    expect(orderInstagram([{ customer: { instagram_handle: "@mattaguiar2" } }], "@luisa_offs")).toBe("mattaguiar2");
  });
  it("não escolhe arbitrariamente entre perfis de pedidos diferentes", () => {
    expect(orderInstagram([{ customer: { instagram_handle: "@mattaguiar2" } }, { customer: { instagram_handle: "@luisa_offs" } }], "luisa_offs")).toBeNull();
  });
  it("sem pedido permite o Instagram informado pela própria pessoa", () => {
    expect(orderInstagram([], "@mattaguiar2")).toBe("mattaguiar2");
  });
  it("mantém a chave usada pelo gatilho de confirmação para o número real", () => {
    expect(selfservicePhoneKey("5533991955003")).toBe("3991955003");
  });
});