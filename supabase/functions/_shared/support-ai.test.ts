import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { finalDecision, firstName, sanitizeText, shouldRouteSupport, trackingNeedsHuman, triageIgnores, triageToIntent, type TrackingInfo } from "./support-ai.ts";
import { trackingFromSim } from "./support-context.ts";

const online = [{ ref: "P1", data: "2026-11-01", canal: "online" as const, status: "completed", entregue_em: "2026-11-06", itens: [] }];
const loja = [{ ...online[0], canal: "loja" as const }];

Deno.test("privacidade: CPF, telefone, e-mail e CEP não vão para a IA", () => {
  const t = sanitizeText("meu cpf 123.456.789-09 tel (33) 99120-8852 email a@b.com cep 35010-000");
  for (const bad of ["123.456", "99120", "a@b.com", "35010"]) assert(!t.includes(bad), bad);
});
Deno.test("primeiro nome", () => { assertEquals(firstName("ANA paula"), "Ana"); assertEquals(firstName("@ana123"), null); });
Deno.test("venda e nada não geram resposta", () => {
  assert(triageIgnores("venda")); assert(triageIgnores("nada")); assert(!triageIgnores("outro_suporte"));
});
Deno.test("ambíguo conta como indefinido", () => assertEquals(triageToIntent("troca_ou_devolucao_ambiguo"), "indefinido"));
Deno.test("decisão do sistema: escalar vence link", () =>
  assertEquals(finalDecision({ link: { ref: "P1", tipo: "troca" }, handoff: { motivo: "defeito", resumo: "" } }, online).decision, "fila"));
Deno.test("decisão do sistema: link validado", () => assertEquals(finalDecision({ link: { ref: "P1", tipo: "devolucao" }, handoff: null }, online).decision, "enviar_link"));
Deno.test("decisão do sistema: compra na loja sem link", () => assertEquals(finalDecision({ link: null, handoff: null }, loja).decision, "presencial"));
Deno.test("decisão do sistema: só conversa", () => assertEquals(finalDecision({ link: null, handoff: null }, online).decision, "conversa"));

const tk = (p: Partial<TrackingInfo>): TrackingInfo => ({ url: "https://checkout.bananacalcados.com.br/rastreio/BC1", etapa: "enviado", enviado_em: "2026-11-01", entregue_em: null, ocorrencia: false, dias_desde_envio: 3, ...p });
Deno.test("rastreio enviado com link: segue conversa", () => assertEquals(finalDecision({ link: null, handoff: null, tracking: { ref: "P1", info: tk({}) } }, online).decision, "conversa"));
Deno.test("rastreio com atraso grande vai para humano", () => assertEquals(finalDecision({ link: null, handoff: null, tracking: { ref: "P1", info: tk({ dias_desde_envio: 20 }) } }, online).reason, "rastreio:atraso_grande"));
Deno.test("rastreio com ocorrência vai para humano", () => assertEquals(trackingNeedsHuman(tk({ ocorrencia: true })), "ocorrencia_na_entrega"));
Deno.test("enviado sem link de rastreio vai para humano", () => assertEquals(trackingNeedsHuman(tk({ url: null })), "sem_rastreio"));
Deno.test("em separação não precisa de humano", () => assertEquals(trackingNeedsHuman(tk({ etapa: "em_separacao", enviado_em: null, dias_desde_envio: null })), null));
Deno.test("link de rastreio é o mesmo da confirmação", () => assertEquals(trackingFromSim({ tracking_code: "BCZUP2C8", stage: "enviado", stage_history: { enviado: "2026-11-10T10:00:00Z" } }, false, Date.parse("2026-11-12T10:00:00Z"))?.url, "https://checkout.bananacalcados.com.br/rastreio/BCZUP2C8"));
Deno.test("último evento só com interruptor ligado", () => {
  const sim = { tracking_code: "X", stage: "enviado", real_events: [{ description: "Saiu para entrega" }] };
  assertEquals(trackingFromSim(sim, false)?.ultimo_evento, undefined);
  assertEquals(trackingFromSim(sim, true)?.ultimo_evento, "Saiu para entrega");
});
Deno.test("linha suporte: rastreio move, venda não", () => { assertEquals(shouldRouteSupport("rastreio", false), true); assertEquals(shouldRouteSupport("venda", false), false); assertEquals(shouldRouteSupport("nada", true), true); });
Deno.test("rastreio vira intenção rastreio", () => assertEquals(triageToIntent("rastreio"), "rastreio"));
