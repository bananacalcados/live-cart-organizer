// O que a Appmax considera "pedido pago" para estorno.
// "autorizado" = análise em andamento (mesma regra do appmax-webhook): o
// pagamento ainda não foi capturado, então não pode ser estornado.
// Rodar com: deno test --allow-env supabase/functions/_shared/refund-gateways/
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appmaxCheckPayment, appmaxExecuteRefund } from "./appmax.ts";

const ORDER = "900100";
const TOTAL = 199.99;

function fakeSupabase() {
  const row = { merchant_client_id: "cid", merchant_client_secret: "secret" };
  return {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
    }),
  };
}

/** Responde como a Appmax: token, pedido com o status dado e o endpoint de estorno. */
function stubFetch(status: string) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: any) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("oauth2/token")) return Promise.resolve(json({ access_token: "tok" }));
    if (url.includes("refund-request")) return Promise.resolve(json({ data: { id: 1, status: "solicitado" } }));
    return Promise.resolve(json({ data: { order: { id: ORDER, status, total_paid: 19999, payment_type: "pix" } } }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

Deno.test("autorizado não é pago: a conferência bloqueia", async () => {
  const f = stubFetch("autorizado");
  const check = await appmaxCheckPayment(fakeSupabase(), ORDER, TOTAL, TOTAL);
  f.restore();
  assertEquals(check.ok, false);
  assertStringIncludes(String(check.error), "em análise");
});

Deno.test("autorizado não é pago: o estorno não é chamado", async () => {
  const f = stubFetch("authorized");
  const res = await appmaxExecuteRefund(fakeSupabase(), ORDER, TOTAL);
  f.restore();
  assertEquals(res.kind, "failed");
  assertEquals(f.calls.some((u) => u.includes("refund-request")), false);
});

Deno.test("aprovado continua elegível com o valor integral", async () => {
  const f = stubFetch("aprovado");
  const check = await appmaxCheckPayment(fakeSupabase(), ORDER, TOTAL, TOTAL);
  f.restore();
  assertEquals(check.ok, true);
  assertEquals(check.remaining, TOTAL);
});
