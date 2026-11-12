import { assertEquals } from "jsr:@std/assert@1";
import { budgetAllows, costPrefilter, DAILY_TOKEN_BUDGET, requestTokenReservation, supportKeywords } from "./support-cost.ts";
const now = Date.parse("2026-11-12T12:00:00Z");
const input = { text: "Oi", now };
Deno.test("pré-filtro: pedido até 60 dias, não 61", () => {
  assertEquals(costPrefilter({ ...input, lastOrderAt: new Date(now - 60 * 864e5).toISOString() }), null);
  assertEquals(costPrefilter({ ...input, lastOrderAt: new Date(now - 61 * 864e5).toISOString() }), "sem_pedido_ou_palavra");
});
Deno.test("pré-filtro: todas as palavras aprovadas passam sem pedido", () => {
  for (const text of ["troca", "trocar", "devolver", "devolução", "reembolso", "estorno", "rastreio", "rastrear", "não chegou", "cadê", "entrega", "defeito", "cancelar", "código", "postagem", "numeração", "ficou pequeno", "ficou grande", "não serviu"]) assertEquals(supportKeywords(text), true, text);
  assertEquals(supportKeywords("Mais informações sobre comprar"), false);
});
Deno.test("pré-filtro: grupos, mídia sem texto, figurinha e reação ignorados", () => {
  for (const x of [{ text: "troca", group: true }, { text: "" }, { text: "👍" }, { text: "troca", mediaType: "sticker" }, { text: "troca", mediaType: "reaction" }]) assertEquals(costPrefilter({ ...input, ...x }) !== null, true);
  assertEquals(costPrefilter({ ...input, text: "troca", mediaType: "image" }), null);
});
Deno.test("pré-filtro: humano nas últimas 2h bloqueia e depois libera", () => {
  assertEquals(costPrefilter({ ...input, text: "troca", lastHumanAt: new Date(now - 2 * 36e5).toISOString() }), "humano_2h");
  assertEquals(costPrefilter({ ...input, text: "troca", lastHumanAt: new Date(now - 2 * 36e5 - 1).toISOString() }), null);
});
Deno.test("agrupamento: aguarda 2 minutos de silêncio", () => {
  assertEquals(costPrefilter({ ...input, text: "troca", lastIncomingAt: new Date(now - 119999).toISOString() }), "aguardando_silencio");
  assertEquals(costPrefilter({ ...input, text: "troca", lastIncomingAt: new Date(now - 120000).toISOString() }), null);
});
Deno.test("teto: padrão 2 milhões, reservas concorrentes e dia seguinte", () => {
  assertEquals(DAILY_TOKEN_BUDGET, 2000000);
  assertEquals(budgetAllows(1900000, 50000, 50000), true);
  assertEquals(budgetAllows(1900000, 50000, 50001), false);
  assertEquals(budgetAllows(2000000, 0, 1), false);
  assertEquals(budgetAllows(0, 0, 1), true);
  assertEquals(requestTokenReservation("abc"), 132099);
});