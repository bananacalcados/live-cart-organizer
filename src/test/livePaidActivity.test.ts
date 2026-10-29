import { describe, it, expect } from "vitest";
import { paidChatOrder, paidGroupActivity, markPaidGroupSeen } from "@/lib/livePaidActivity";
import { compareLiveContacts } from "@/lib/liveContactUnread";
const older = "2026-10-29T17:00:00Z";
const newer = "2026-10-29T17:01:00Z";
const phone = "5533999991234";
const rep = { id: "master", customer: { whatsapp: phone }, last_customer_message_at: older };
describe("atendimento em pedidos pagos", () => {
  it("considera a mensagem de outro pedido agrupado, não apenas do mestre", () => {
    const state = paidGroupActivity([rep, { ...rep, id: "child", last_customer_message_at: newer }], {}, { [phone.slice(-8)]: Date.parse(older) });
    expect(state).toEqual({ unread: true, lastIncomingAt: newer });
  });
  it("abrir o chat lê os pedidos e nova mensagem volta a destacar", () => {
    localStorage.clear();
    markPaidGroupSeen("event", [rep], Date.parse(older));
    const seen = JSON.parse(localStorage.getItem("live-contact-seen:event") || "{}");
    expect(paidGroupActivity([rep], {}, seen).unread).toBe(false);
    expect(paidGroupActivity([rep], { [phone]: { lastIn: newer, lastOut: null } }, seen).unread).toBe(true);
  });
  it("coloca não lidos à esquerda e o mais recente primeiro", () => {
    const items = [{ key: "read", unread: false, lastIncomingAt: newer, createdAt: newer }, { key: "old", unread: true, lastIncomingAt: older, createdAt: newer }, { key: "new", unread: true, lastIncomingAt: newer, createdAt: older }];
    expect(items.sort(compareLiveContacts).map((v) => v.key)).toEqual(["new", "old", "read"]);
  });
  it("o chat de grupo usa pedido com telefone sem alterar o representante", () => {
    const noPhone = { id: "master" };
    expect(paidChatOrder(noPhone, [noPhone, rep]).id).toBe("master");
    expect(paidChatOrder({ id: "empty" }, [{ id: "empty" }, { ...rep, id: "child" }]).id).toBe("child");
  });
  it("broadcast de outro DDD não contamina a atividade", () => {
    expect(paidGroupActivity([{ ...rep, last_customer_message_at: null }], { "5564999991234": { lastIn: newer, lastOut: null } }, {}).unread).toBe(false);
  });
});