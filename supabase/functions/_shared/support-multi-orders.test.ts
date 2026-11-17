import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { finalDecision, runAgent, type Triage } from "./support-ai.ts";
const cfg = { apiKey: "x", baseURL: "http://127.0.0.1:1", timeoutMs: 10 };
const now = Date.parse("2026-11-17T18:00:00Z");
const tri = (categoria: any): Triage => ({ categoria, confianca: 0.99, justificativa: "j", motivo_tamanho: false, facts: { selected_ref: null } as any });
const o = (ref: string, produto: string, data = "2026-11-14", entregue_em: string | null = null) => ({ ref, data, canal: "online" as const, status: "paid", entregue_em, itens: [{ item: "I1", produto, tamanho: "36", quantidade: 1 }] });
const T = "https://checkout.bananacalcados.com.br/rastreio/";
const conv = [{ from: "cliente" as const, text: "manda o código de rastreio por favor", at: "2026-11-17T04:17:00Z" }];
const base = (orders: any[], track: Record<string, any>, elig: Record<string, string> = {}) => ({
  orders, now, offersAlreadyMade: 0, maxOffers: 1, sizesInStock: async () => ({ tamanhos: [] }),
  checkEligibility: async (r: string) => ({ elegivel: elig[r] ?? "eligible", motivo: "x", prazo_ate: null }),
  tracking: async (r: string) => track[r] ?? null,
});
const sent = (code: string) => ({ url: T + code, etapa: "enviado", enviado_em: "2026-11-15", entregue_em: null, ocorrencia: false, dias_desde_envio: 2 });
const sep = { url: null, etapa: "em_separacao", enviado_em: null, entregue_em: null, ocorrencia: false, dias_desde_envio: null };

Deno.test("rastreio com 3 pedidos: responde cada um, junta os do mesmo código, sem escalar", async () => {
  const orders = [o("P1", "Tênis Nike Air"), o("P2", "Sandália Bege"), o("P3", "Bota Preta")];
  const out = await runAgent(cfg, "x", "", "Ana", tri("rastreio"), conv, base(orders, { P1: sent("BC1"), P2: sent("BC1"), P3: sep }) as any, () => {});
  assertEquals(out.handoff, null);
  assertEquals(finalDecision(out, orders as any), { decision: "conversa", reason: "rastreio_varios_pedidos" });
  assertStringIncludes(out.text, "Tênis Nike Air e Sandália Bege (foram juntos): enviado. Acompanhe: " + T + "BC1");
  assertStringIncludes(out.text, "Bota Preta: em separação.");
  assertEquals(out.text.split(T + "BC1").length, 2);
});
Deno.test("rastreio: mais de 4 pedidos recentes escala; entregue há mais de 7 dias não conta", async () => {
  const five = ["P1", "P2", "P3", "P4", "P5"].map((r) => o(r, "X"));
  const a = await runAgent(cfg, "x", "", null, tri("rastreio"), conv, base(five, {}) as any, () => {});
  assertEquals(a.handoff?.motivo, "varios_pedidos_mais_de_4");
  const old = [o("P1", "A", "2026-11-01", "2026-11-05"), o("P2", "B", "2026-10-01")];
  const b = await runAgent(cfg, "x", "", null, tri("rastreio"), conv, base(old, {}) as any, () => {});
  assertEquals(b.handoff?.motivo, "pedido_nao_localizado");
});
Deno.test("troca com vários pedidos: pergunta qual produto, sem link", async () => {
  const orders = [o("P1", "Tênis A"), o("P2", "Tênis B"), o("P3", "Tênis C")];
  const out = await runAgent(cfg, "x", "", "Ana", tri("troca"), [{ from: "cliente", text: "quero trocar", at: "2026-11-17T10:00:00Z" }], base(orders, {}, { P3: "ineligible" }) as any, () => {});
  assertEquals(out.link, null); assertEquals(out.handoff, null);
  assertStringIncludes(out.text, "qual destes produtos você quer trocar?");
  assert(out.text.includes("Tênis A") && out.text.includes("Tênis B") && !out.text.includes("Tênis C"));
  assertEquals(finalDecision(out, orders as any).reason, "perguntou_qual_produto");
});
