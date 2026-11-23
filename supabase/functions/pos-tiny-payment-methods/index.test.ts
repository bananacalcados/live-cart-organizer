import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("formas de pagamento do PDV não consultam nem renovam token do Tiny", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!src.includes("api.tiny.com.br"), "As formas de pagamento voltaram a chamar o Tiny");
  assert(!src.includes("accounts.tiny.com.br"), "As formas de pagamento voltaram a renovar token do Tiny");
  assert(!src.includes("tiny_token"), "As formas de pagamento voltaram a depender do token da loja");
  assert(!src.includes("tiny_app_token"), "As formas de pagamento voltaram a depender do token do aplicativo");
});

Deno.test("resposta mantém a lista local e o formato usado pelas telas", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const expected of [
    ".from('pos_payment_methods')",
    ".select('id, name')",
    ".eq('is_active', true)",
    ".order('sort_order')",
    "success: true, methods: cached || [], source: 'cache'",
  ]) {
    assert(src.includes(expected), `Resposta local sem ${expected}`);
  }
  assert(!src.includes(".upsert("), "A leitura local voltou a alterar o cadastro");
});
