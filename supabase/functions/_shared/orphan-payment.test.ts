import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideDeletedPayment, deletedPaymentCandidates, orphanPhoneKey } from "./orphan-payment.ts";

const candidate = (id: string, customerId = "customer") => ({ id, customer_id: customerId, customer: { instagram_handle: "@cida", whatsapp: "5519995351335" } });
const expected = { base: 100, min: 95 };

Deno.test("pedido excluído com um candidato e valor batendo concilia", () => {
  assertEquals(decideDeletedPayment(null, [candidate("new-order")], 95, expected), "reconcile");
});

Deno.test("valor diferente vira órfão", () => {
  assertEquals(decideDeletedPayment(null, [candidate("new-order")], 50, expected), "orphan");
});

Deno.test("dois candidatos viram órfão mesmo com valor possível", () => {
  assertEquals(decideDeletedPayment(null, [candidate("one"), candidate("two")], 100, expected), "orphan");
});

Deno.test("reprocessamento de órfão resolvido é ignorado", () => {
  assertEquals(decideDeletedPayment("resolved", [candidate("new-order")], 95, expected), "skip");
});

Deno.test("identidade aceita mesmo cliente, DDD+8 ou final quatro com @", () => {
  const orders = [candidate("same-customer"), { ...candidate("same-phone", "other"), customer_id: "other" }];
  const found = deletedPaymentCandidates(orders, { customer_id: "missing", phone_last4: "1335" }, { instagram_handle: "@cida", whatsapp: "551995351335" });
  assertEquals(found.map((row) => row.id), ["same-customer", "same-phone"]);
  assertEquals(orphanPhoneKey("5519995351335"), orphanPhoneKey("551995351335"));
});
