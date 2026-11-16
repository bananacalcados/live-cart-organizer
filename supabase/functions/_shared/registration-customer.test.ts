import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { registrationCustomerIds } from "./registration-customer.ts";

Deno.test("inclui pedido casado pelo telefone, mesmo sem marcação de Instagram", () => {
  assertEquals(registrationCustomerIds([{ customer_id: "phone-match" }]), ["phone-match"]);
});

Deno.test("inclui todos os pedidos e remove só IDs repetidos ou vazios", () => {
  assertEquals(registrationCustomerIds([
    { customer_id: "instagram-match" },
    { customer_id: "phone-match" },
    { customer_id: "instagram-match" },
    { customer_id: null },
    {},
  ]), ["instagram-match", "phone-match"]);
});
