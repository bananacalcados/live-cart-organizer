import { describe, expect, it } from "vitest";
import { pickConfirmedGateway, canGrantWithoutGateway } from "../../supabase/functions/_shared/selfservice-cashback-rule";

describe("gateway que confirmou o pagamento do autoatendimento", () => {
  it("Appmax com erro + Pagar.me aprovado confere na Pagar.me", () => {
    const order = { appmax_order_id: "130724912", pagarme_order_id: "or_N8oAxpmcA0H3DdVK" };
    const attempts = [
      { gateway: "pagarme", status: "failed", created_at: "2026-10-24T19:10:40Z" },
      { gateway: "appmax", status: "error", created_at: "2026-10-24T19:10:46Z" },
      { gateway: "pagarme", status: "success", created_at: "2026-10-24T19:12:09Z" },
    ];
    expect(pickConfirmedGateway(order, attempts)).toBe("pagarme");
  });
  it("sem tentativas usa a observação 'Pago via' antes do primeiro id", () =>
    expect(pickConfirmedGateway({ appmax_order_id: "1", pagarme_order_id: "or_x", notes: "💳 Pago via pagarme (or_x)" }, [])).toBe("pagarme"));
  it("pedido pago por webhook pode receber cashback sem conferência", () => expect(canGrantWithoutGateway("gateway_webhook")).toBe(true));
  it("pedido marcado pago manualmente pode receber cashback sem conferência", () => expect(canGrantWithoutGateway("manual")).toBe(true));
  it("pedido sem confirmação do sistema não ganha cashback sem conferência", () => expect(canGrantWithoutGateway(null)).toBe(false));
});
