import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { categorizeAppmaxTokenizeError, friendlyCardFailure, hasGatewayFallback } from "./card-failure.ts";

Deno.test("erro genérico de tokenize da AppMax segue a cascata", () => {
  assertEquals(categorizeAppmaxTokenizeError({ errors: { message: "Transaction processing error" } }), { stopCascade: false, declineCategory: "unknown" });
});

Deno.test("erro explícito de cartão inválido para a cascata", () => {
  assertEquals(categorizeAppmaxTokenizeError({ errors: { message: "Invalid card number" } }), { stopCascade: true, declineCategory: "card_data" });
});

Deno.test("fallback identifica o gateway sem diferenciar maiúsculas", () => {
  assert(hasGatewayFallback(["APPMAX: falha"], "appmax"));
  assertEquals(hasGatewayFallback(["Pagar.me: falha"], "appmax"), false);
});

Deno.test("cliente recebe orientação amigável e nunca o JSON do gateway", () => {
  const message = friendlyCardFailure({ error: 'AppMax v2 tokenize error: {"errors":{"message":"Transaction processing error"}}', declineCategory: "unknown" });
  assertEquals(message, "Não conseguimos aprovar o pagamento com este cartão. Confira os dados, tente outro cartão ou pague no Pix (5% de desconto).");
  assert(!message.includes("tokenize"));
  assert(!message.includes("Transaction"));
});
