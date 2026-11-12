import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { completedRefundText, refundConsultNeedsHuman } from "./support-refund.ts";
import { isRefundStatusQuestion, type UnifiedMessage } from "./support-policy.ts";
const msg = (text: string): UnifiedMessage => ({ from: "cliente", text, at: "2026-01-01T00:00:00Z", instance_id: "i", human: false });

Deno.test("estorno concluído informa valor, data e reenvio do comprovante", () => {
  const result = { status: "concluido" as const, amount: 459.99, completedAt: "2026-11-11T21:28:16Z", receiptSent: true };
  assertFalse(refundConsultNeedsHuman(result));
  const text = completedRefundText("Vânia", result);
  assert(text.replace(/\u00a0/g, " ").includes("R$ 459,99"));
  assert(text.includes("11/11/2026"));
  assert(text.includes("Reenviei o comprovante"));
});

Deno.test("só pergunta de status/comprovante usa a ferramenta; pedido novo de estorno continua humano", () => {
  assert(isRefundStatusQuestion([msg("Cadê meu estorno?")]));
  assert(isRefundStatusQuestion([msg("Pode reenviar o comprovante do reembolso?")]));
  assertFalse(isRefundStatusQuestion([msg("Quero estorno, quero meu dinheiro de volta")]));
  assertFalse(isRefundStatusQuestion([msg("Estorno? Vou reclamar no Procon")]));
});

Deno.test("estorno pendente, falhou ou erro de envio passa para humano", () => {
  for (const result of [
    { status: "pendente" as const }, { status: "falhou" as const },
    { status: "sem_estorno" as const }, { status: "erro" as const },
    { status: "concluido" as const, receiptSent: false },
  ]) assert(refundConsultNeedsHuman(result));
  assertEquals(refundConsultNeedsHuman({ status: "concluido", receiptSent: true }), false);
});
