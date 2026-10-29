import { describe, expect, it } from "vitest";
import type { DbOrder } from "@/types/database";
import { isLiveOrderIncomplete, projectRegistrationPhones, isLiveOrderConversationUnread } from "@/lib/liveOrderLanes";
import { paidGroupActivity } from "@/lib/livePaidActivity";

const order = { id: "cart", stage: "incomplete_order", is_paid: false, products: [{ id: "product" }], customer: { whatsapp: "" } } as DbOrder;
describe("linhas da live com carrinho montado", () => {
  it("resposta mais recente no WhatsApp não vira não lida por comentário antigo no Instagram", () => {
    const answered = paidGroupActivity([{ ...order, customer: { whatsapp: "5541999231736" }, last_customer_message_at: "2026-10-29T19:00:00Z", last_sent_message_at: "2026-10-29T19:01:00Z" }], {}, {}).unread;
    expect(isLiveOrderConversationUnread(true, answered, true)).toBe(false);
    expect(isLiveOrderConversationUnread(true, true, false)).toBe(true);
    expect(isLiveOrderConversationUnread(false, false, true)).toBe(true);
  });
  it("usa cadastro do pedido exato para retirar o contato de Novos Contatos", () => {
    const projected = projectRegistrationPhones([order], { cart: "5541999231736" })[0];
    expect(projected.customer?.whatsapp).toBe("5541999231736");
    expect(order.customer?.whatsapp).toBe("");
    expect(projectRegistrationPhones([order], { another: "5541999231736" })[0]).toBe(order);
  });
  it("carrinho com telefone e produtos aguarda pagamento mesmo com etapa antiga incompleta", () => {
    const projected = projectRegistrationPhones([order], { cart: "5541999231736" })[0];
    expect(isLiveOrderIncomplete(projected)).toBe(false);
    expect(isLiveOrderIncomplete({ ...projected, products: [] })).toBe(true);
    expect(isLiveOrderIncomplete(order)).toBe(true);
  });
  it("nova mensagem não lida tem prioridade e leitura permite voltar a aguardar", () => {
    const projected = projectRegistrationPhones([order], { cart: "5541999231736" })[0];
    const live = { "5541999231736": { lastIn: "2026-10-29T19:00:00Z", lastOut: null } };
    expect(paidGroupActivity([projected], live, {}).unread).toBe(true);
    expect(paidGroupActivity([projected], live, { "99231736": Date.parse("2026-10-29T19:00:00Z") }).unread).toBe(false);
    expect(paidGroupActivity([projected], { "5541999231736": { ...live["5541999231736"], lastIn: "2026-10-29T19:01:00Z" } }, { "99231736": Date.parse("2026-10-29T19:00:00Z") }).unread).toBe(true);
  });
  it("preserva telefone já existente na ficha", () => {
    const manual = { ...order, customer: { ...order.customer, whatsapp: "5533999991234" } } as DbOrder;
    expect(projectRegistrationPhones([manual], { cart: "5541999231736" })[0]).toBe(manual);
  });
});