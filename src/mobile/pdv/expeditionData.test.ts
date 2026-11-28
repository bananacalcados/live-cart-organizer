import { describe, expect, it } from "vitest";
import { mobileOrderAddress, mobileMissingOrderData } from "./expeditionData";
import type { ExpOrder } from "@/lib/pos/expedition";
const order = (patch: Partial<ExpOrder>) => ({ customer_name: "Cliente", payment_details: {}, expedition_stage: "novo", ...patch } as ExpOrder);
describe("mobile address reads without writes", () => {
  it("reads street for #20C740A1", () => {
    const o = order({ expedition_stage: "preparacao", shipping_address: { street: "Rua Pernambuco", number: "519", neighborhood: "Bela Vista", city: "Passos", state: "MG", cep: "37900242" } });
    expect(mobileOrderAddress(o).address).toBe("Rua Pernambuco");
    expect(mobileMissingOrderData(o)).toEqual([]);
  });
  it("reads street and complement for #BB3A74E0", () => {
    const o = order({ shipping_address: { street: "Rua Cobe", number: "997", complement: "Casa 1", neighborhood: "Bangu", city: "Rio de Janeiro", state: "RJ", cep: "21820200" } });
    expect(mobileOrderAddress(o)).toMatchObject({ address: "Rua Cobe", complement: "Casa 1", cep: "21820200" });
    expect(mobileMissingOrderData(o)).toEqual([]);
  });
  it("manual address wins over source aliases and customer metadata", () => {
    expect(mobileOrderAddress(order({ shipping_address: { address: "Rua manual", street: "Rua importada" }, payment_details: { customer_address: "Rua link" } }), { address: "Rua ficha" }).address).toBe("Rua manual");
  });
  it("supports Shopify and metadata keys without making extra requirements", () => {
    expect(mobileOrderAddress(order({ shipping_address: { address1: "Rua Shopify", numero: "8", province: "MG", zip_code: "35000000" } }))).toMatchObject({ address: "Rua Shopify", number: "8", state: "MG", cep: "35000000" });
    expect(mobileOrderAddress(order({ payment_details: { customer_address: "Rua link" } })).address).toBe("Rua link");
  });
  it("requires shipping only at conference", () => {
    expect(mobileMissingOrderData(order({ expedition_stage: "novo" }))).toEqual([]);
    expect(mobileMissingOrderData(order({ expedition_stage: "conferencia" }))).toEqual(["frete"]);
  });
  it("requires address for a selected carrier, not pickup", () => {
    expect(mobileMissingOrderData(order({ shipping_carrier: "Correios PAC" }))).toEqual(["CEP", "endereço"]);
    expect(mobileMissingOrderData(order({ shipping_carrier: "Retirada na loja" }))).toEqual([]);
  });
  it("matches desktop conversion of empty shipping cost to zero", () => {
    const o = order({ expedition_stage: "conferencia", shipping_carrier: "Mototaxi", courier_name: "Entregador", shipping_cost: null,
      shipping_address: { street: "Rua A", number: "1", neighborhood: "Centro", city: "GV", state: "MG", cep: "35000000" } });
    expect(mobileMissingOrderData(o)).toEqual([]);
  });
});