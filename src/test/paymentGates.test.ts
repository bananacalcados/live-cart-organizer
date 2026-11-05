import { describe, it, expect } from "vitest";
import { shopifyOrderBlockReason, paymentMatchesOrder, clientAmountMatches } from "../../supabase/functions/_shared/payment-gates";

describe("Fase 4 — pedido Shopify só para pedido pago", () => {
  it("bloqueia pedido não pago", () => {
    expect(shopifyOrderBlockReason({ is_paid: false, paid_at: null, payment_confirmed_source: null })).toBe("not_paid");
  });
  it("bloqueia pedido já criado na Shopify", () => {
    expect(shopifyOrderBlockReason({ is_paid: true, paid_at: "2026-11-05", payment_confirmed_source: "gateway_webhook", shopify_order_id: "1" })).toBe("already_created");
  });
  it("bloqueia origem de pagamento desconhecida", () => {
    expect(shopifyOrderBlockReason({ is_paid: true, paid_at: "2026-11-05", payment_confirmed_source: "navegador" })).toBe("unknown_paid_source");
  });
  it("libera pedido pago por webhook verificado", () => {
    expect(shopifyOrderBlockReason({ is_paid: true, paid_at: "2026-11-05", payment_confirmed_source: "gateway_webhook" })).toBeNull();
  });
});

describe("Fase 4 — consulta de pagamento exige referência E valor", () => {
  it("recusa pagamento de outro pedido", () => {
    expect(paymentMatchesOrder({ reference: "outro", amount: 300 }, "pedido", 300, 300)).toBe("reference");
  });
  it("recusa valor abaixo do pedido", () => {
    expect(paymentMatchesOrder({ reference: "pedido", amount: 10 }, "pedido", 300, 300)).toBe("amount");
  });
  it("aceita valor acima (juros)", () => {
    expect(paymentMatchesOrder({ reference: "pedido", amount: 330 }, "pedido", 300, 300)).toBe("ok");
  });
});

describe("Fase 4 — valor do navegador só é comparado", () => {
  it("recusa total adulterado para baixo", () => {
    expect(clientAmountMatches(100, 30000)).toBe(false);
  });
  it("aceita diferença de até 5 centavos", () => {
    expect(clientAmountMatches(29996, 30000)).toBe(true);
  });
});
