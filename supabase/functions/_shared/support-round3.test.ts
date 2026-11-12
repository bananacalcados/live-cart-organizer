import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { alreadyResolved, consolidationAllowed, cpfRequestAllowed, hasPendingCustomerRequest, linkText, primaryInstance, publicCommentReply, silentHandoffText, waitingMinutes, withinWindowByShipping, humanRepliedRecently, type UnifiedMessage } from "./support-policy.ts";
import { finalDecision, runAgent, type Triage } from "./support-ai.ts";
const m = (from: "cliente" | "loja", text: string, at: string, instance_id = "A", human = from === "loja"): UnifiedMessage => ({ from, text, at, instance_id, human });
const cfg = { apiKey: "x", baseURL: "http://127.0.0.1:1", timeoutMs: 10 };
const tri = (categoria: any, facts = {}): Triage => ({ categoria, confianca: 0.9, justificativa: "j", motivo_tamanho: true, facts });
const order = { ref: "P1", data: "2026-11-05", canal: "online" as const, status: "paid", entregue_em: null, itens: [] };
const deps = (o: any = {}) => ({ orders: [order], checkEligibility: async () => ({ elegivel: "eligible", motivo: "dentro_do_prazo", prazo_ate: null }), sizesInStock: async () => ({ tamanhos: [] }), offersAlreadyMade: 0, maxOffers: 1, ...o });

Deno.test("1 caso resolvido: agradecimento/emoji depois da loja = nada", async () => {
  for (const t of ["Obrigada!", "🙏", "👍", "ok", "Muito obrigada pela ajuda"]) assert(alreadyResolved([m("cliente", "estorno?", "1"), m("loja", "Estorno feito!", "2"), m("cliente", t, "3")]), t);
  assertFalse(alreadyResolved([m("loja", "Estorno feito", "1"), m("cliente", "ficou pequeno, quero trocar", "2")]));
  const o = await runAgent(cfg, "x", "", "Maria", tri("troca"), [m("loja", "Segue o código de postagem", "1"), m("cliente", "👍", "2")], deps(), () => {});
  assertEquals(finalDecision(o, [order]).decision, "nada"); assertEquals(o.text, "");
});
Deno.test("1b resposta vazia depois de confirmação de rastreio não é falha", () => {
  const encerrada = [m("cliente", "cadê meu rastreio?", "1"), m("loja", "Segue o rastreio", "2"), m("cliente", "Eu achei o rastreio. Estou acompanhando aqui. Muito obrigada.", "3")];
  assert(alreadyResolved(encerrada));
  assertFalse(hasPendingCustomerRequest(encerrada));
  assert(hasPendingCustomerRequest([m("loja", "Vou verificar", "1"), m("cliente", "Mas quando chega meu pedido?", "2")]));
  assert(hasPendingCustomerRequest([m("loja", "Segue o rastreio", "1"), m("cliente", "Não achei o rastreio, pode reenviar?", "2")]));
});

Deno.test("2 prazo garantido pela data de envio", async () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  assert(withinWindowByShipping("2026-11-06", now)); assertFalse(withinWindowByShipping("2026-11-01", now)); assertFalse(withinWindowByShipping(null, now));
  const d = deps({ now, checkEligibility: async () => ({ elegivel: "needs_human", motivo: "sem_data_de_entrega", prazo_ate: null }), shippedAt: async () => "2026-11-06" });
  const o = await runAgent(cfg, "x", "", "Joyce", tri("troca"), [m("cliente", "meu tênis ficou pequeno, como faço a troca?", "2026-11-11T11:59:00Z")], d, () => {});
  assertEquals(o.link?.tipo, "troca"); assertEquals(finalDecision(o, [order]).reason, "prazo_garantido_pela_data_de_envio");
  const late = await runAgent(cfg, "x", "", "Joyce", tri("troca"), [m("cliente", "ficou pequeno", "2026-11-11T11:59:00Z")], { ...d, shippedAt: async () => "2026-10-20" }, () => {});
  assertEquals(late.handoff?.motivo, "sem_data_de_entrega");
});
Deno.test("2b após envio + 7, usa a data de recebimento informada pela cliente", async () => {
  const now = Date.parse("2026-11-12T20:45:00Z");
  const calls: (string | null | undefined)[] = [];
  const d = deps({ now, shippedAt: async () => "2026-11-04T17:03:07Z", customerReceivedDate: async () => ({ date: "2026-11-11", claimed: true }), checkEligibility: async (_r: string, _t: string, date?: string | null) => { calls.push(date); return date ? { elegivel: "eligible", motivo: "data_informada_pelo_cliente", prazo_ate: "2026-11-18" } : { elegivel: "needs_human", motivo: "sem_data_de_entrega", prazo_ate: null }; } });
  const o = await runAgent(cfg, "x", "", "Arlete", tri("devolucao"), [m("cliente", "Recebi ontem 11\\11\\26", "2026-11-12T19:03:17Z")], d, () => {});
  assertEquals(calls, [undefined, "2026-11-11"]); assertEquals(o.link?.tipo, "troca"); assertEquals(finalDecision(o, [order]).reason, "prazo_pela_data_informada_pela_cliente");
});
Deno.test("2c após envio + 7 e sem data, pergunta antes de enviar link", async () => {
  const d = deps({ now: Date.parse("2026-11-12T20:45:00Z"), shippedAt: async () => "2026-11-04T17:03:07Z", customerReceivedDate: async () => ({ date: null, claimed: false }), checkEligibility: async () => ({ elegivel: "needs_human", motivo: "sem_data_de_entrega", prazo_ate: null }) });
  const o = await runAgent(cfg, "x", "", "Arlete", tri("devolucao"), [m("cliente", "qual o procedimento para devolução?", "2026-11-12T19:03:17Z")], d, () => {});
  assert(o.text.includes("qual dia recebeu")); assertEquals(o.link, null); assertEquals(o.handoff, null);
});
Deno.test("3 escalar em silêncio, mensagem só após 30 min e útil", async () => {
  assertEquals(silentHandoffText("situacao_sensivel", 10, "Ana"), "");
  assertEquals(silentHandoffText("varios_pedidos", 60, "Ana"), "");
  assert(silentHandoffText("estorno", 45, "Ana").includes("estorno"));
  assertEquals(waitingMinutes([m("loja", "x", "2026-11-11T10:00:00Z"), m("cliente", "y", "2026-11-11T10:10:00Z")], Date.parse("2026-11-11T10:50:00Z")), 40);
  let modelCalled = false;
  const o = await runAgent(cfg, "x", "", "Ana", tri("troca", { danger: true }), [m("cliente", "procon", new Date().toISOString())], deps(), () => {}, () => { modelCalled = true; });
  assertEquals(o.text, ""); assert(o.handoff); assertFalse(modelCalled);
});
Deno.test("4 CPF só com suporte ativo e nunca em comentário público", async () => {
  assert(cpfRequestAllowed("troca", [m("cliente", "quero trocar", "1")], false));
  assertFalse(cpfRequestAllowed("troca", [m("cliente", "quero trocar", "1")], true));
  assertFalse(cpfRequestAllowed("nada", [m("cliente", "oi", "1")], false));
  assertFalse(cpfRequestAllowed("troca", [m("loja", "Código enviado", "1"), m("cliente", "obrigada", "2")], false));
  const c = await runAgent(cfg, "x", "", "Bia", tri("troca"), [m("cliente", "quero trocar", "1")], deps({ orders: [], publicComment: true, cpfLookup: async () => { throw new Error("nunca"); } }), () => {});
  assert(c.text.includes("wa.me") || c.text.includes("direct")); assertFalse(/cpf|\{\{link\}\}|central/i.test(c.text)); assert(c.handoff);
  assert(publicCommentReply("Bia", "+55 33 9999-0000").includes("wa.me/553399990000"));
});
Deno.test("5 consolidação só com atendimento ativo, nunca genérico, uma vez", () => {
  const base = [m("cliente", "quero trocar o tamanho", "1", "B", false), m("loja", "Qual numeração?", "2", "B", true)];
  assert(consolidationAllowed([...base, m("cliente", "quero trocar meu tênis", "3", "A", false)], "B", "troca"));
  assertFalse(consolidationAllowed([...base, m("cliente", "Mais informações", "3", "A", false)], "B", "troca"));
  assertFalse(consolidationAllowed([m("cliente", "troca", "1", "B", false), m("loja", "Resolvido, código enviado.", "2", "B", true), m("cliente", "quero trocar", "3", "A", false)], "B", "troca"));
  assertFalse(consolidationAllowed([...base, m("loja", "Vi que você... vamos manter seu atendimento só por lá e finalizar", "2.5", "A", false), m("cliente", "quero trocar", "3", "A", false)], "B", "troca"));
});
Deno.test("6 uma sugestão: número mais ativo", () => {
  assertEquals(primaryInstance([m("cliente", "troca", "1", "META", false), m("cliente", "quero trocar o 37", "2", "WHATS", false), m("cliente", "👍", "3", "META", false)]), "WHATS");
});
Deno.test("7 tom: primeiro nome, caloroso, termina com pergunta", () => {
  const t = linkText("troca", "Joyce", false, false);
  assert(t.startsWith("Maravilha, Joyce!")); assert(t.includes("{{link}}")); assert(t.trim().endsWith("?"));
  assert(linkText("devolucao", "Fabiane", true, false).includes("Fabiane")); assert(linkText("troca", "Ana", false, true).endsWith("?"));
});
Deno.test("8 humano nas últimas 2h", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  assert(humanRepliedRecently([m("loja", "oi", "2026-11-11T11:00:00Z")], now)); assertFalse(humanRepliedRecently([m("loja", "oi", "2026-11-11T08:00:00Z")], now));
});
