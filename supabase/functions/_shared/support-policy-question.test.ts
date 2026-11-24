import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isPolicyQuestion, policyAnswerText } from "./support-policy.ts";
import { finalDecision, runAgent } from "./support-ai.ts";

Deno.test("pergunta hipotética de troca é política, pedido concreto não", () => {
  assert(isPolicyQuestion("Se precisar trocar a numeração vocês trocam?"));
  assert(isPolicyQuestion("vcs trocam se não servir?"));
  assert(isPolicyQuestion("Tem troca?"));
  assert(!isPolicyQuestion("Quero trocar, ficou pequeno"));
  assert(!isPolicyQuestion("não serviu, preciso trocar"));
  assert(!isPolicyQuestion("cadê meu pedido?"));
  assert(isPolicyQuestion("Se precisar trocar a numeração vcs trocam??"));
  assert(!isPolicyQuestion("Se eu quiser trocar o NB T176 nº 35 bege que comprei hoje pelo T178 branco 35, essa troca pode ser feita agora antes do envio?"));
  assert(!isPolicyQuestion("Ela disse que não tinha 39 aí eu falei pode mandar o 38"));
});

Deno.test("texto da política: 7 dias pela entrega; loja só troca na loja; termina com pergunta", () => {
  const online = policyAnswerText("Laura", ["online"]);
  assert(online.includes("até 7 dias, contando o dia da entrega do pedido")); assert(online.endsWith("?"));
  const loja = policyAnswerText(null, ["loja"]);
  assert(loja.includes("troca, feita direto na loja")); assert(!loja.includes("devolução"));
});

Deno.test("compra de hoje ainda não entregue: responde a política e não escala", async () => {
  const order = { ref: "P1", data: "2026-11-24", canal: "online", status: "completed", entregue_em: null, itens: [] } as any;
  const out = await runAgent({ apiKey: "k", baseURL: "http://x", timeoutMs: 1 }, "m", "", "Lucineide",
    { categoria: "troca", confianca: 0.9, justificativa: "", motivo_tamanho: true, facts: {} } as any,
    [{ from: "cliente", text: "se precisar trocar a numeração vocês trocam?", at: "2026-11-24T15:00:00Z" }] as any,
    { orders: [order], now: Date.parse("2026-11-24T15:01:00Z"), offersAlreadyMade: 0, maxOffers: 1,
      checkEligibility: async () => ({ elegivel: "needs_human", motivo: "sem_data_de_entrega", prazo_ate: null }) } as any, () => {});
  assertEquals(out.handoff, null);
  assert(out.text.includes("7 dias"));
  assertEquals(finalDecision(out, [order]).reason, "politica_troca_respondida");
});
