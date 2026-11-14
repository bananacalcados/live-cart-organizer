import { describe, expect, it } from "vitest";
import {
  buildPresenterHandleData,
  getRegistrationAlert,
  type IgHandleSummary,
  type PresenterCommentOrder,
  type PresenterSelfServiceAccess,
} from "@/lib/presenterCommentSummaries";

const order = (patch: Partial<PresenterCommentOrder> = {}): PresenterCommentOrder => ({
  id: "order-1",
  event_id: "live-atual",
  customer_id: "customer-1",
  handle: "cliente",
  whatsapp: "5532999998888",
  products: [{ title: "Tênis 530", variant: "Caramelo / 36", price: 100, quantity: 2 }],
  stage: "awaiting_confirmation",
  is_paid: false,
  paid_externally: false,
  paid_at: null,
  registered_at: null,
  created_at: "2026-11-14T12:00:00Z",
  ...patch,
});

const emptyHistory = (patch: Partial<IgHandleSummary> = {}): IgHandleSummary => ({
  handle: "cliente",
  customer_id: "customer-1",
  whatsapp: "5532999998888",
  open_other: 0,
  unconfirmed_other: 0,
  paid_other: 0,
  cancelled_other: 0,
  paid_other_events: [],
  cancelled_other_events: [],
  purchases: [],
  ...patch,
});

const build = (
  orders: PresenterCommentOrder[],
  accesses: PresenterSelfServiceAccess[] = [],
  history = emptyHistory(),
  previous?: Map<string, any>,
) => buildPresenterHandleData("live-atual", "Live de hoje", ["cliente"], orders, new Map([["cliente", history]]), accesses, previous);

describe("presenterCommentSummaries", () => {
  it("soma as quantidades e mantém todos os itens do carrinho", () => {
    const data = build([order({
      products: [
        { title: "Tênis 530", variant: "Caramelo / 36", price: 100, quantity: 2 },
        { title: "Bolsa", variant: "Preta / U", price: 50, quantity: 1 },
      ],
    })]).get("cliente")!;
    expect(data.cart?.productCount).toBe(3);
    expect(data.cart?.total).toBe(250);
    expect(data.cart?.productNames).toEqual(["Tênis 530 · Caramelo / 36", "Bolsa · Preta / U"]);
    expect(data.registrationAlert).toBe("not_opened");
  });

  it("diferencia link não aberto, cadastro incompleto e cadastro concluído", () => {
    const cart = order();
    expect(getRegistrationAlert(cart, cart.whatsapp, []).alert).toBe("not_opened");
    expect(getRegistrationAlert(cart, cart.whatsapp, [{ id: "a1", phone_key: "32999998888", registered_at: null }]).alert).toBe("opened_unfinished");
    expect(getRegistrationAlert(cart, cart.whatsapp, [{ id: "a2", instagram: "@Cliente", registered_at: "2026-11-14T12:10:00Z" }]).alert).toBe("none");
    expect(getRegistrationAlert(order({ registered_at: "2026-11-14T12:10:00Z" }), cart.whatsapp, []).alert).toBe("none");
  });

  it("casa o acesso pelo pedido mesmo sem telefone ou Instagram", () => {
    expect(getRegistrationAlert(order(), null, [{ id: "a1", order_ids: ["order-1"], registered_at: null }]).alert).toBe("opened_unfinished");
  });

  it("usa pagamento externo e etapa logística como compra paga", () => {
    const data = build([
      order({ id: "p1", stage: "new", is_paid: true, paid_externally: true, paid_at: "2026-11-14T13:00:00Z" }),
      order({ id: "p2", stage: "shipped", created_at: "2026-11-13T13:00:00Z" }),
    ]).get("cliente")!;
    expect(data.paidCurrent).toBe(2);
    expect(data.purchases.map((purchase) => purchase.order_id)).toEqual(["p1", "p2"]);
    expect(data.cart).toBeNull();
  });

  it("substitui a compra atual antiga da RPC pelo pedido em tempo real", () => {
    const current = order({ id: "atual", stage: "paid", is_paid: true, paid_at: "2026-11-14T14:00:00Z" });
    const history = emptyHistory({
      purchases: [
        { order_id: "atual", event_name: "Nome velho", paid_at: "2026-11-14T13:00:00Z", items: [] },
        { order_id: "antiga", event_name: "Live anterior", paid_at: "2026-11-01T13:00:00Z", items: [{ title: "Sapato", variant: "37", quantity: 1 }] },
      ],
    });
    const data = build([current], [], history).get("cliente")!;
    expect(data.purchases).toHaveLength(2);
    expect(data.purchases[0]).toMatchObject({ order_id: "atual", event_name: "Live de hoje", paid_at: "2026-11-14T14:00:00Z" });
    expect(data.purchases[1].order_id).toBe("antiga");
  });

  it("preserva a referência dos cards quando os dados de origem não mudaram", () => {
    const current = order();
    const accesses = [{ id: "a1", order_ids: ["order-1"], registered_at: null }];
    const history = emptyHistory();
    const first = build([current], accesses, history);
    const second = build([current], accesses, history, first);
    expect(second.get("cliente")).toBe(first.get("cliente"));
  });
});
