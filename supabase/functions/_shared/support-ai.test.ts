import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { finalDecision, firstName, sanitizeText, triageIgnores, triageToIntent } from "./support-ai.ts";

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
