import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickStartGateway, buildCardOrder } from "./gateway-split.ts";

Deno.test("distribuição respeita os percentuais", () => {
  const pct = { mercadopago: 60, pagarme: 30, appmax: 10 };
  const c: Record<string, number> = {};
  for (let i = 0; i < 10000; i++) {
    const g = pickStartGateway(crypto.randomUUID(), pct)!;
    c[g] = (c[g] || 0) + 1;
  }
  console.log(c);
  for (const [g, p] of Object.entries(pct)) {
    if (Math.abs(c[g] / 100 - p) > 2.5) throw new Error(`${g} fora: ${c[g] / 100}%`);
  }
});

Deno.test("mesmo pedido sempre começa no mesmo gateway", () => {
  const id = crypto.randomUUID();
  const pct = { mercadopago: 34, pagarme: 33, appmax: 33 };
  const first = pickStartGateway(id, pct);
  for (let i = 0; i < 50; i++) assertEquals(pickStartGateway(id, pct), first);
});

Deno.test("soma diferente de 100 cai na ordem padrão", () => {
  assertEquals(pickStartGateway("x", { mercadopago: 50 }), null);
  assertEquals(buildCardOrder(null), ["mercadopago", "pagarme", "vindi", "appmax"]);
  assertEquals(buildCardOrder("appmax"), ["appmax", "mercadopago", "pagarme", "vindi"]);
});
