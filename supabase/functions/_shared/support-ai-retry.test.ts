import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  classifySupportAiError, runSupportAiWithRetry, shouldRetrySupportAi, SUPPORT_CLAUDE_AGENT_MODEL, supportAlternateModel,
} from "./support-ai-retry.ts";

const EMPTY = "No output generated. Check the stream for errors.";

Deno.test("stream vazio 1x: repete o mesmo modelo após 2 s e segue, sem pausa", async () => {
  const models: string[] = []; const waits: number[] = [];
  const r = await runSupportAiWithRetry({
    primaryModel: "openai/gpt-6-luna", alternateModel: "openai/gpt-6-astra", fallbackModel: SUPPORT_CLAUDE_AGENT_MODEL,
    run: async (m) => { models.push(m); if (models.length === 1) throw new Error(EMPTY); return "ok"; },
    onAttempt: () => {}, wait: async (ms) => { waits.push(ms); },
  });
  assertEquals(r, "ok");
  assertEquals(models, ["openai/gpt-6-luna", "openai/gpt-6-luna"]);
  assertEquals(waits, [2000]);
});

Deno.test("luna e astra falham: usa Claude e registra as tentativas", async () => {
  const attempts: any[] = []; const waits: number[] = [];
  const r = await runSupportAiWithRetry({
    primaryModel: "openai/gpt-6-luna", alternateModel: "openai/gpt-6-astra", fallbackModel: SUPPORT_CLAUDE_AGENT_MODEL,
    run: async (m) => { if (!m.startsWith("claude")) throw Object.assign(new Error("upstream"), { statusCode: 503 }); return "claude"; },
    onAttempt: (a) => { attempts.push(a); }, wait: async (ms) => { waits.push(ms); },
  });
  assertEquals(r, "claude");
  assertEquals(attempts.map((a) => [a.attempt, a.model, a.ok]), [
    [1, "openai/gpt-6-luna", false], [2, "openai/gpt-6-luna", false], [3, "openai/gpt-6-astra", false], [4, SUPPORT_CLAUDE_AGENT_MODEL, true],
  ]);
  assertEquals(waits, [2000, 8000]);
});

Deno.test("conta recusada no Lovable (402/403) pula direto para o Claude", async () => {
  const models: string[] = [];
  await runSupportAiWithRetry({
    primaryModel: "openai/gpt-6-luna", alternateModel: "openai/gpt-6-astra", fallbackModel: SUPPORT_CLAUDE_AGENT_MODEL,
    run: async (m) => { models.push(m); if (!m.startsWith("claude")) throw Object.assign(new Error("sem crédito"), { statusCode: 402 }); return 1; },
    onAttempt: () => {}, wait: async () => {},
  });
  assertEquals(models, ["openai/gpt-6-luna", SUPPORT_CLAUDE_AGENT_MODEL]);
});

Deno.test("tudo falha: erro final marcado como 'todos os provedores falharam'", async () => {
  let calls = 0;
  const err = await runSupportAiWithRetry({
    primaryModel: "a", alternateModel: "b", fallbackModel: "claude-x",
    run: async () => { calls++; throw new Error(EMPTY); }, onAttempt: () => {}, wait: async () => {},
  }).catch((e) => e);
  assertEquals(calls, 4);
  assertEquals(err.supportAiExhausted, true);
});

Deno.test("teto, pausa vigente e recusa de conteúdo não repetem nem marcam falha geral", async () => {
  for (const m of ["reserva_recusada: teto_diario: usado 1 de 2", "reserva_recusada: ia_pausada_10min: x", "recusa_de_conteudo | " + EMPTY]) {
    let calls = 0;
    const err = await runSupportAiWithRetry({ primaryModel: "a", alternateModel: "b", fallbackModel: "claude-x",
      run: async () => { calls++; throw new Error(m); }, onAttempt: () => {}, wait: async () => {} }).catch((e) => e);
    assertEquals(calls, 1, m); assertFalse(err.supportAiExhausted === true, m);
  }
});

Deno.test("classificação: stream vazio, 5xx, 429 e tempo esgotado são transitórios", () => {
  assertEquals(classifySupportAiError(new Error(EMPTY)), "transient");
  assertEquals(classifySupportAiError(Object.assign(new Error("x"), { status: 500 })), "transient");
  assertEquals(classifySupportAiError(Object.assign(new Error("x"), { status: 429 })), "transient");
  assertEquals(classifySupportAiError(new DOMException("timeout", "TimeoutError")), "transient");
  assertEquals(classifySupportAiError(new Error("stream_falhou: server_error | " + EMPTY)), "transient");
  assertEquals(classifySupportAiError(Object.assign(new Error("x"), { status: 403 })), "provider");
  assert(shouldRetrySupportAi(new Error("triagem_vazia_ou_invalida")));
});

Deno.test("tempo esgotado não repete o mesmo modelo", async () => {
  const models: string[] = [];
  await runSupportAiWithRetry({ primaryModel: "a", alternateModel: "b", fallbackModel: null,
    run: async (m) => { models.push(m); if (m === "a") throw new DOMException("timeout", "TimeoutError"); return 1; },
    onAttempt: () => {}, wait: async () => {} });
  assertEquals(models, ["a", "b"]);
});

Deno.test("modelo alternativo nunca repete o principal", () => {
  assertEquals(supportAlternateModel("openai/gpt-6-luna", "openai/gpt-6-luna"), "openai/gpt-6-astra");
  assertEquals(supportAlternateModel("openai/gpt-6-astra", "openai/gpt-6-luna"), "openai/gpt-6-luna");
});

Deno.test("triagem com chaves inventadas é normalizada", async () => {
  const { parseTriageOutput } = await import("./support-ai.ts");
  const t = parseTriageOutput('{"categoria":"devolucao","confianca":0.99,"justificativa":"x","motivo_tamanho":null,"facts":{"pedido_ref":"P1"}}');
  assertEquals(t.categoria, "devolucao"); assertEquals(t.facts?.danger, false);
});
