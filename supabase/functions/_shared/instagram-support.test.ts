import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { instagramDmHandoff, instagramSupportCommentKind, instagramSupportCommentMessage, instagramWhatsappLink } from "./instagram-support.ts";
import { runAgent, type Triage } from "./support-ai.ts";

const PHONE = "5533991208852";
const cfg = { apiKey: "x", baseURL: "http://127.0.0.1:1", timeoutMs: 10 };
const triage = (categoria: Triage["categoria"]): Triage => ({ categoria, confianca: 0.95, justificativa: "teste", motivo_tamanho: false, facts: {} });
const order = { ref: "P1", data: "2026-11-01", canal: "online" as const, status: "paid", entregue_em: null, itens: [] };
const baseDeps = (extra: Record<string, unknown> = {}) => ({
  orders: [], checkEligibility: async () => ({ elegivel: "eligible", motivo: "ok", prazo_ate: null }),
  sizesInStock: async () => ({ tamanhos: [] }), offersAlreadyMade: 0, maxOffers: 1,
  instagram: true, instagramHandle: "dmw_boutique", supportPhone: PHONE, ...extra,
});

Deno.test("comentários de suporte são detectados sem IA e neutros ficam de fora", () => {
  assertEquals(instagramSupportCommentKind("comprei e não chegou"), "rastreio");
  assertEquals(instagramSupportCommentKind("Minha compra não está aparecendo no site"), "rastreio");
  assertEquals(instagramSupportCommentKind("quero trocar"), "troca_devolucao");
  assertEquals(instagramSupportCommentKind("qual o procedimento para devolução?"), "troca_devolucao");
  assertEquals(instagramSupportCommentKind("que tênis lindo, tem 37?"), null);
});

Deno.test("convite usa wa.me com texto preenchido e nunca pede CPF no comentário", () => {
  const link = instagramWhatsappLink(PHONE, "dmw_boutique")!;
  assert(link.startsWith("https://wa.me/5533991208852?text="));
  assert(decodeURIComponent(link).includes("@dmw_boutique"));
  const comment = instagramSupportCommentMessage("dmw_boutique", PHONE);
  assert(comment.includes(link));
  assertFalse(/cpf/i.test(comment));
  const dm = instagramDmHandoff(null, PHONE, "dmw_boutique", true);
  assert(dm.includes("WhatsApp ou CPF aqui no direct"));
});

Deno.test("DM sem pedido identificado leva ao WhatsApp sem chamar o modelo", async () => {
  let modelCalled = false;
  const out = await runAgent(cfg, "x", "", null, triage("rastreio"), [{ from: "cliente", text: "minha compra não aparece", at: "2026-11-13T12:00:00Z" }], baseDeps(), () => {}, () => { modelCalled = true; });
  assert(out.text.includes("https://wa.me/5533991208852?text="));
  assert(out.text.includes("WhatsApp ou CPF"));
  assertFalse(modelCalled);
});

Deno.test("DM com um pedido seguro responde o rastreio direto sem chamar o modelo", async () => {
  let modelCalled = false;
  const info = { url: "https://checkout.bananacalcados.com.br/rastreio/BC-123456", etapa: "enviado" as const, enviado_em: "2026-11-12", entregue_em: null, ocorrencia: false, dias_desde_envio: 1 };
  const out = await runAgent(cfg, "x", "", "Ana", triage("rastreio"), [{ from: "cliente", text: "cadê meu pedido?", at: "2026-11-13T12:00:00Z" }], baseDeps({ orders: [order], tracking: async () => info }), () => {}, () => { modelCalled = true; });
  assert(out.text.includes(info.url));
  assert(out.text.includes("foi enviado"));
  assertEquals(out.tracking?.info, info);
  assertFalse(modelCalled);
});

Deno.test("troca no Instagram vai para o WhatsApp e não gera link da Central", async () => {
  let modelCalled = false;
  const out = await runAgent(cfg, "x", "", "Ana", triage("troca"), [{ from: "cliente", text: "quero trocar", at: "2026-11-13T12:00:00Z" }], baseDeps({ orders: [order] }), () => {}, () => { modelCalled = true; });
  assert(out.text.includes("https://wa.me/"));
  assertEquals(out.link, null);
  assertFalse(out.text.includes("{{link}}"));
  assertFalse(modelCalled);
});
