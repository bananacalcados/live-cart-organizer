import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { finalDecision, runAgent, type AgentDeps, type ConvMessage, type Triage } from "./support-ai.ts";
import { acceptsExchange, currentCustomerText, hasOriginalityClaim, insistsOnReturn, resolveReturnFlow, returnFlowContinuation } from "./support-return-flow.ts";

const cfg = { apiKey: "unused", baseURL: "http://127.0.0.1:1", timeoutMs: 10 };
const order = { ref: "P1", data: "2026-11-05", canal: "online" as const, status: "paid", entregue_em: "2026-11-12", itens: [] };
const deps = (extra: Partial<AgentDeps> = {}): AgentDeps => ({
  orders: [order], offersAlreadyMade: 0, maxOffers: 1,
  checkEligibility: async () => ({ elegivel: "eligible", motivo: "dentro_do_prazo", prazo_ate: null }),
  sizesInStock: async () => ({ tamanhos: [] }), ...extra,
});
const triage = (categoria: Triage["categoria"] = "devolucao"): Triage => ({
  categoria, confianca: 1, justificativa: "simulação", motivo_tamanho: false, facts: {},
});
const msg = (from: "cliente" | "loja", text: string, at: string): ConvMessage => ({ from, text, at });

Deno.test("passo 1: quero devolver sem motivo pergunta e não manda link", async () => {
  const out = await runAgent(cfg, "x", "", "Eliani", triage(), [msg("cliente", "Recebi meu pedido mas quero devolver\nPodem me auxiliar?", "1")], deps(), () => {});
  assertEquals(out.returnFlowState, "motivo_perguntado"); assertEquals(out.link, null);
  assert(out.text.includes("motivo da devolução")); assertFalse(out.text.includes("{{link}}"));
});

Deno.test("passo 2: não é original manda devolução direto, sem discutir", async () => {
  for (const text of ["quero devolver porque não é original", "parece réplica", "é falsificado", "é uma imitação"]) {
    assert(hasOriginalityClaim(text), text);
    const out = await runAgent(cfg, "x", "", "Ana", triage(), [msg("cliente", text, "1")], deps(), () => {});
    assertEquals(out.link?.tipo, "devolucao"); assertEquals(out.returnFlowState, "devolucao_confirmada");
    assert(out.text.includes("{{link}}")); assertFalse(out.text.includes("Que tal"));
  }
});

Deno.test("passo 3a: ficou pequeno gera oferta de troca sem link", async () => {
  const flow = { state: "motivo_perguntado" as const, reason: null, pendingLink: null };
  const out = await runAgent(cfg, "x", "", "Ana", triage("troca"), [msg("cliente", "ficou pequeno", "1")], deps({ returnFlow: flow }), () => {});
  assertEquals(out.returnFlowState, "troca_oferecida"); assertEquals(out.link, null); assert(out.exchangeOffered);
  assert(out.text.includes("numeração")); assert(out.text.trim().endsWith("?")); assertFalse(out.text.includes("{{link}}"));
});

Deno.test("passo 3b: não gostei gera uma única oferta sem link", async () => {
  const out = await runAgent(cfg, "x", "", "Ana", triage(), [msg("cliente", "não gostei", "1")], deps(), () => {});
  assertEquals(out.returnFlowState, "troca_oferecida"); assertEquals(out.link, null); assert(out.text.endsWith("?"));
});

Deno.test("passo 4: cliente aceita e só então recebe troca", async () => {
  const flow = { state: "troca_oferecida" as const, reason: "tamanho", pendingLink: null };
  for (const text of ["sim, quero", "pode fazer a troca", "aceito"]) {
    assert(acceptsExchange(text), text);
    const out = await runAgent(cfg, "x", "", "Ana", triage("nada"), [msg("cliente", text, "1")], deps({ returnFlow: flow }), () => {});
    assertEquals(out.link?.tipo, "troca"); assertEquals(out.returnFlowState, "troca_aceita"); assertFalse(out.exchangeOffered);
  }
});

Deno.test("passo 5: insistência depois da oferta manda devolução sem nova tentativa", async () => {
  const flow = { state: "troca_oferecida" as const, reason: "nao_gostou", pendingLink: null };
  for (const text of ["não, quero devolver", "prefiro devolver mesmo", "quero meu dinheiro de volta"]) {
    assert(insistsOnReturn(text), text);
    const out = await runAgent(cfg, "x", "", "Ana", triage(), [msg("cliente", text, "1")], deps({ returnFlow: flow }), () => {});
    assertEquals(out.link?.tipo, "devolucao"); assertEquals(out.returnFlowState, "devolucao_confirmada"); assertFalse(out.exchangeOffered);
  }
});

Deno.test("passo 6: defeito continua com humano; fora do prazo não gera link", async () => {
  const sensitive = await runAgent(cfg, "x", "", "Ana", triage(), [msg("cliente", "quero devolver porque descolou", "1")], deps(), () => {});
  assertEquals(sensitive.handoff?.motivo, "defeito_ou_situacao_sensivel"); assertEquals(sensitive.link, null);
  const late = await runAgent(cfg, "x", "", "Ana", triage(), [msg("cliente", "não é original", "1")], deps({ checkEligibility: async () => ({ elegivel: "needs_human", motivo: "fora_do_prazo", prazo_ate: null }) }), () => {});
  assertEquals(late.handoff?.motivo, "fora_do_prazo"); assertEquals(late.link, null);
  const lateBeforeReason = await runAgent(cfg, "x", "", "Ana", triage(), [msg("cliente", "quero devolver", "1")], deps({ checkEligibility: async () => ({ elegivel: "needs_human", motivo: "fora_do_prazo", prazo_ate: null }) }), () => {});
  assertEquals(lateBeforeReason.handoff?.motivo, "fora_do_prazo"); assertEquals(lateBeforeReason.text, "");
});

Deno.test("recusa da troca não é tratada como pedido sensível de estorno", async () => {
  const flow = { state: "troca_oferecida" as const, reason: "nao_gostou", pendingLink: null };
  const sensitiveTriage = { ...triage(), facts: { danger: true } };
  const out = await runAgent(cfg, "x", "", "Ana", sensitiveTriage, [msg("cliente", "não, quero devolver", "1")], deps({ returnFlow: flow }), () => {});
  assertEquals(out.link?.tipo, "devolucao"); assertEquals(out.handoff, null);
});

Deno.test("troca pedida diretamente continua com link imediato", async () => {
  const out = await runAgent(cfg, "x", "", "Ana", triage("troca"), [msg("cliente", "quero trocar", "1")], deps(), () => {});
  assertEquals(out.link?.tipo, "troca"); assertEquals(out.returnFlowState, undefined);
});

Deno.test("continuidade só nas etapas ativas ou com link aguardando prazo", () => {
  assert(returnFlowContinuation({ state: "motivo_perguntado" }));
  assert(returnFlowContinuation({ state: "troca_oferecida" }));
  assert(returnFlowContinuation({ state: "troca_aceita", pendingLink: "troca" }));
  assertFalse(returnFlowContinuation({ state: "troca_aceita" }));
  assertFalse(returnFlowContinuation({ state: "devolucao_confirmada" }));
});

Deno.test("data informada durante a pergunta de motivo não vira motivo nem trava a continuidade", async () => {
  const flow = { state: "motivo_perguntado" as const, reason: null, pendingLink: null };
  const out = await runAgent(cfg, "x", "", "Ana", triage(), [msg("cliente", "recebi dia 12/11/2026", "1")], deps({ returnFlow: flow }), () => {});
  assertEquals(out.returnFlowState, "motivo_perguntado"); assert(out.text.includes("motivo da devolução")); assertEquals(out.link, null);
});

Deno.test("data de recebimento preserva a ação já aceita até liberar o link", async () => {
  const flow = { state: "troca_aceita" as const, reason: "tamanho", pendingLink: "troca" as const };
  const out = await runAgent(cfg, "x", "", "Ana", triage("nada"), [msg("cliente", "recebi dia 12/11/2026", "1")], deps({ returnFlow: flow }), () => {});
  assertEquals(out.link?.tipo, "troca"); assertEquals(out.returnFlowPendingLink, undefined);
  assertEquals(finalDecision(out, [order]).decision, "enviar_link");
});

Deno.test("texto da etapa usa somente a resposta atual da cliente", () => {
  assertEquals(currentCustomerText([msg("loja", "quer trocar?", "1"), msg("cliente", "não gostei", "2")]), "não gostei");
  assertEquals(resolveReturnFlow({ category: "devolucao", text: "quero devolver", nome: null, offersAlreadyMade: 0, maxOffers: 1 })?.kind, "text");
});
