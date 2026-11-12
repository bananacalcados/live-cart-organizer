import { assert, assertEquals } from "jsr:@std/assert@1";
import { agentOutcomeIsEmpty, conversationTranscript, describeMediaText, parseTriageOutput, SUPPORT_AI_HISTORY_LIMIT, type ConvMessage } from "./support-ai.ts";

const msg = (i: number, text = `mensagem ${i}`): ConvMessage => ({
  from: i % 2 ? "cliente" : "loja",
  text,
  at: `2026-11-12T20:${String(i % 60).padStart(2, "0")}:00Z`,
  instance: i % 3 ? "Whats Pérola" : "Meta Pérola",
  instance_id: i % 3 ? "A" : "B",
});

Deno.test("histórico longo: últimas 40, resumo e até 6 trechos antigos de suporte", () => {
  const all = Array.from({ length: 80 }, (_, i) => msg(i, i === 2 ? "quero trocar a numeração" : undefined));
  const text = conversationTranscript(all);
  assert(text.includes("40 mensagens entre"));
  assert(text.includes("quero trocar a numeração"));
  assert(text.includes("MENSAGENS RECENTES"));
  assert(text.includes("mensagem 79"));
  assert(!text.includes("mensagem 39\n"));
  const lines = text.split("\n").filter((line) => line.includes("mensagem "));
  assertEquals(lines.length, SUPPORT_AI_HISTORY_LIMIT);
});

Deno.test("histórico curto não ganha resumo", () => {
  assertEquals(conversationTranscript([msg(1), msg(2)]), conversationTranscript([msg(1), msg(2)]));
  assert(!conversationTranscript([msg(1), msg(2)]).includes("RESUMO DO HISTÓRICO"));
});

Deno.test("recupera o JSON completo que o SDK marcou como sem saída", () => {
  const parsed = parseTriageOutput('{"categoria":"troca","confianca":0.84,"justificativa":"Cliente pediu troca.","motivo_tamanho":false,"facts":{"originality":false,"danger":false,"selected_ref":null,"insisted_return":false,"exchange_offer_made":false,"same_subject_instance":null,"confirmed_product":null}}');
  assertEquals(parsed.categoria, "troca");
  assertEquals(parsed.confianca, 0.84);
  assertEquals(parsed.facts?.danger, false);
});

Deno.test("resposta vazia sem ferramenta aciona nova tentativa; escalada válida não", () => {
  const base = { text: "", actions: [], link: null, handoff: null, tracking: null };
  assert(agentOutcomeIsEmpty(base));
  assert(!agentOutcomeIsEmpty({ ...base, handoff: { motivo: "sem_data", resumo: "x" } }));
  assert(!agentOutcomeIsEmpty({ ...base, actions: [{ acao: "consultar_rastreio", pedido: {}, resultado: {} }] }));
});

Deno.test("mídia fica descrita sem fingir transcrição ou análise", () => {
  assertEquals(describeMediaText("📎 audio", "cliente"), "[Mídia: áudio da cliente; conteúdo não transcrito]");
  assertEquals(describeMediaText("[imagem]", "loja"), "[Mídia: imagem da loja; conteúdo visual não analisado]");
  assert(describeMediaText("📎 document", "cliente").includes("documento da cliente"));
  assert(conversationTranscript([msg(1, "📎 audio")]).includes("não transcrito"));
});
