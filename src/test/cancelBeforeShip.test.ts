import { describe, expect, it, vi } from "vitest";
import { maybeCancelUnshippedSale } from "../../supabase/functions/_shared/refund-post-actions";

function sb(sale: any) {
  const update = vi.fn(() => ({ eq: () => ({ neq: () => ({ is: async () => ({ error: null }) }) }) }));
  return { update, client: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sale }) }) }), update }) } };
}
describe("pedido cancelado antes do envio sai da Expedição", () => {
  it("não despachado: cancela", async () => {
    const m = sb({ status: "paid", shipped_at: null, expedition_stage: "separacao" });
    expect(await maybeCancelUnshippedSale(m.client, "s1")).toBe(true);
    expect(m.update).toHaveBeenCalledWith({ status: "cancelled", status_cancelamento: "cancelado" });
  });
  it("já despachado: não mexe", async () => {
    const m = sb({ status: "paid", shipped_at: "2026-11-10T10:00:00Z", expedition_stage: "concluido" });
    expect(await maybeCancelUnshippedSale(m.client, "s1")).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
  });
});
