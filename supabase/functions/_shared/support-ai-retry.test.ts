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
