import { describe, expect, it } from "vitest";
import { resolveMpSalePayment } from "@/lib/mpSalePayment";
describe("pagamento MP da venda", () => {
  const order = { id: "order-1", pos_sale_id: "sale-1", mercadopago_payment_id: "185052537862", mp_account_id: "order-account" };
  it("prioriza pagamento e conta da própria venda", () => {
    expect(resolveMpSalePayment({ id: "sale-1", mercadopago_payment_id: "sale-payment", mp_account_id: "sale-account" }, [order])).toEqual({ paymentId: "sale-payment", accountId: "sale-account", orderId: null, error: null });
  });
  it("usa pagamento e conta do pedido convertido quando a venda está vazia", () => {
    expect(resolveMpSalePayment({ id: "sale-1" }, [order])).toEqual({ paymentId: "185052537862", accountId: "order-account", orderId: "order-1", error: null });
  });
  it("bloqueia dois pagamentos diferentes", () => {
    const result = resolveMpSalePayment({ id: "sale-1" }, [order, { ...order, id: "order-2", mercadopago_payment_id: "other-payment" }]);
    expect(result.paymentId).toBeNull();
    expect(result.error).toBeTruthy();
  });
  it("não usa pedido de outra venda", () => { expect(resolveMpSalePayment({ id: "sale-2" }, [order]).paymentId).toBeNull(); });
  it("aceita pedidos que repetem o mesmo pagamento e conta", () => { expect(resolveMpSalePayment({ id: "sale-1" }, [order, { ...order, id: "order-2" }]).paymentId).toBe("185052537862"); });
});