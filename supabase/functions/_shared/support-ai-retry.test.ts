import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { runSupportAiWithRetry, shouldRetrySupportAi, supportAlternateModel } from "./support-ai-retry.ts";

Deno.test("falha vazia: segunda tentativa usa o modelo alternativo e registra as duas", async () => {
  const attempts: unknown[] = [];
  const models: string[] = [];
  const result = await runSupportAiWithRetry({
    primaryModel: "openai/gpt-6-luna",
    alternateModel: "openai/gpt-6-astra",
    run: async (model) => {
      models.push(model);
      if (model.endsWith("luna")) throw new Error("No output generated. Check the stream for errors.");
      return "resposta";
    },
    onAttempt: (attempt) => { attempts.push(attempt); },
    wait: async () => {},
  });
  assertEquals(result, "resposta");
  assertEquals(models, ["openai/gpt-6-luna", "openai/gpt-6-astra"]);
  assertEquals(attempts.map((a: any) => [a.attempt, a.model, a.ok]), [
    [1, "openai/gpt-6-luna", false],
    [2, "openai/gpt-6-astra", true],
  ]);
  assertEquals((attempts[0] as any).error, "No output generated. Check the stream for errors.");
});

Deno.test("no máximo duas tentativas antes da reserva", async () => {
  let calls = 0;
  try {
    await runSupportAiWithRetry({
      primaryModel: "a", alternateModel: "b",
      run: async () => { calls++; throw new Error("No output generated"); },
      onAttempt: () => {}, wait: async () => {},
    });
    assert(false, "deveria falhar");
  } catch (error) {
    assertEquals((error as Error).message, "No output generated");
  }
  assertEquals(calls, 2);
});

Deno.test("recusa, tempo esgotado e erros terminais não são repetidos", () => {
  assertFalse(shouldRetrySupportAi(Object.assign(new Error("provider denied"), { status: 403 })));
  assertFalse(shouldRetrySupportAi(Object.assign(new Error("bad request"), { status: 400 })));
  assertFalse(shouldRetrySupportAi(new DOMException("timeout", "TimeoutError")));
  assertFalse(shouldRetrySupportAi(Object.assign(new Error("No output generated"), { text: "{invalido" })));
  assert(shouldRetrySupportAi(Object.assign(new Error("rate limited"), { status: 429 })));
  assert(shouldRetrySupportAi(Object.assign(new Error("upstream"), { status: 500 })));
  assert(shouldRetrySupportAi(new Error("No output generated")));
});

Deno.test("modelo alternativo nunca repete o principal", () => {
  assertEquals(supportAlternateModel("openai/gpt-6-luna", "openai/gpt-6-luna"), "openai/gpt-6-astra");
  assertEquals(supportAlternateModel("openai/gpt-6-astra", "openai/gpt-6-luna"), "openai/gpt-6-luna");
});

Deno.test("triagem inválida (chaves inventadas) é normalizada e, se ainda inválida, repete no outro modelo", async () => {
  const { parseTriageOutput } = await import("./support-ai.ts");
  const real = '{"categoria":"devolucao","confianca":0.99,"justificativa":"pergunta como devolver","motivo_tamanho":null,"facts":{"pedido_ref":"P1","produto":"Tenis"}}';
  const t = parseTriageOutput(real);
  if (t.categoria !== "devolucao" || t.motivo_tamanho !== false || t.facts?.danger !== false) throw new Error("normalização falhou");
  const { shouldRetrySupportAi, runSupportAiWithRetry } = await import("./support-ai-retry.ts");
  if (!shouldRetrySupportAi(new Error("triagem_vazia_ou_invalida"))) throw new Error("deveria repetir");
  const models: string[] = [];
  await runSupportAiWithRetry({ primaryModel: "openai/gpt-6-luna", alternateModel: "openai/gpt-6-astra", wait: async () => {},
    run: async (m) => { models.push(m); if (models.length === 1) throw new Error("triagem_vazia_ou_invalida"); return 1; }, onAttempt: () => {} });
  if (models.join() !== "openai/gpt-6-luna,openai/gpt-6-astra") throw new Error(models.join());
});
