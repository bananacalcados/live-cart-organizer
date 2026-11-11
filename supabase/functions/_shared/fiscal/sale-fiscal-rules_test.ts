import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isOnlineSale, missingOnlineCustomerData } from "./sale-fiscal-rules.ts";

Deno.test("venda online/live/link/whatsapp/retirada bloqueada para NFC-e", () => {
  for (const s of [
    { sale_type: "live", sales_channel: "site" }, { sale_type: "online", sales_channel: "presencial" },
    { sale_type: "physical", sales_channel: "link_online" }, { sale_type: "exchange", sales_channel: "whatsapp" },
    { sale_type: "physical", sales_channel: "presencial", is_store_pickup: true },
  ]) assert(isOnlineSale(s), JSON.stringify(s));
});
Deno.test("venda presencial segue liberada para NFC-e", () => {
  assertEquals(isOnlineSale({ sale_type: "physical", sales_channel: "presencial" }), false);
});
Deno.test("NF-e online sem CPF ou endereço é bloqueada", () => {
  assertEquals(missingOnlineCustomerData({ cpf: "", uf: "MG", city: "GV", neighborhood: "Centro", cep: "35010000" }), ["CPF"]);
  assertEquals(missingOnlineCustomerData({ cpf: "11111111111", uf: "", city: "", neighborhood: "", cep: "123" }), ["CPF", "UF", "município", "bairro", "CEP"]);
  assertEquals(missingOnlineCustomerData({ cpf: "52998224725", uf: "mg", city: "Gov Valadares", neighborhood: "Centro", cep: "35010-000" }), []);
});
