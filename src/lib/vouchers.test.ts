import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { listAvailableVouchers, setTargetVoucher, voucherCoversWholeOrder } from "./vouchers";

beforeEach(() => rpc.mockReset());

describe("voucher — chamadas seguras", () => {
  it("a ficha consulta pelo pedido, com limite e sem baixar lista geral", async () => {
    rpc.mockResolvedValue({ data: [{ id: "v1", saldo: "40.00", applied_amount: "0", is_available: 1 }], error: null });
    const rows = await listAvailableVouchers({ orderId: "order-1" });
    expect(rpc).toHaveBeenCalledWith("available_vouchers_for_target", {
      p_phone: null, p_order_id: "order-1", p_sale_id: null, p_limit: 20, p_offset: 0,
    });
    expect(rows[0]).toMatchObject({ saldo: 40, applied_amount: 0, is_available: true });
  });

  it("aplicar envia somente identificadores; nenhum valor financeiro vem do navegador", async () => {
    rpc.mockResolvedValue({ data: [{ voucher_id: "v1", voucher_amount: "40.00", discount_type: "fixed", discount_value: "40.00", total: "159.99" }], error: null });
    const result = await setTargetVoucher({ orderId: "order-1" }, "v1");
    const payload = rpc.mock.calls[0][1];
    expect(payload).toEqual({ p_order_id: "order-1", p_sale_id: null, p_voucher_id: "v1" });
    expect(payload).not.toHaveProperty("amount");
    expect(payload).not.toHaveProperty("discount");
    expect(payload).not.toHaveProperty("total");
    expect(result).toEqual({ voucher_id: "v1", voucher_amount: 40, discount_type: "fixed", discount_value: 40, total: 159.99 });
  });

  it("remover usa o identificador nulo e devolve o total restaurado pelo servidor", async () => {
    rpc.mockResolvedValue({ data: [{ voucher_id: null, voucher_amount: 0, discount_type: null, discount_value: 0, total: 199.99 }], error: null });
    const result = await setTargetVoucher({ saleId: "sale-1" }, null);
    expect(rpc).toHaveBeenCalledWith("set_target_voucher", { p_order_id: null, p_sale_id: "sale-1", p_voucher_id: null });
    expect(result.total).toBe(199.99);
  });
});

describe("voucher — cobertura total", () => {
  it("R$ 0,00 com voucher permite concluir sem cobrança", () => {
    expect(voucherCoversWholeOrder({ total: 0, voucher_id: "v1" })).toBe(true);
  });
  it("R$ 0,00 sem voucher não libera conclusão", () => {
    expect(voucherCoversWholeOrder({ total: 0 })).toBe(false);
  });
  it("qualquer restante acima de zero exige pagamento", () => {
    expect(voucherCoversWholeOrder({ total: 0.01, voucher_id: "v1" })).toBe(false);
  });
});
