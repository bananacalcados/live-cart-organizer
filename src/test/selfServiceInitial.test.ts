import { describe, expect, it } from "vitest";
import { completeInitialPhone, projectInitialPhones, type InitialLiveContact } from "@/lib/selfServiceInitial";
import type { DbOrder } from "@/types/database";

const order = { id: "one", stage: "incomplete_order", is_paid: false, customer: { id: "customer", whatsapp: "" } } as DbOrder;
const contact: InitialLiveContact = { id: "access", phone: "5533991234567", instagram: "cliente", created_at: "2026-10-24T01:00:00Z", order_ids: ["one"], confirmed: false };
describe("captura inicial na live", () => {
  it("captura apenas WhatsApp completo, nunca um final de quatro dígitos", () => {
    expect(completeInitialPhone("4567")).toBeNull();
    expect(completeInitialPhone("(33) 99123-4567")).toBe("5533991234567");
    expect(completeInitialPhone("3399123456")).toBeNull();
  });
  it("projeta telefone no pedido sem confirmar cadastro nem mudar a ficha", () => {
    const result = projectInitialPhones([order], [contact]);
    expect(result[0].customer?.whatsapp).toBe("5533991234567");
    expect(result[0].initialPhoneUnconfirmed).toBe(true);
    expect(result[0].initialContactAt).toBe("2026-10-24T01:00:00Z");
    expect(order.customer?.whatsapp).toBe("");
    expect(result[0].is_paid).toBe(false);
  });
  it("não vincula dois telefones diferentes ao mesmo pedido", () => {
    expect(projectInitialPhones([order], [contact, { ...contact, phone: "5531981234567" }])[0]).toBe(order);
  });
  it("não substitui telefone manual nem reclassifica pedido pago", () => {
    const manual = { ...order, customer: { ...order.customer, whatsapp: "5533987654321" } } as DbOrder;
    expect(projectInitialPhones([manual], [contact])[0]).toBe(manual);
    const paid = { ...order, is_paid: true };
    expect(projectInitialPhones([paid], [contact])[0]).toBe(paid);
  });
});
