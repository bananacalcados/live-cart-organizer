import { describe, it, expect } from "vitest";
import { canConvertToExchange } from "@/lib/pos/exchangeInProgress";
describe("canConvertToExchange", () => {
  it("só devolução aberta sem voucher/estorno", () => {
    expect(canConvertToExchange({ tipo: "devolucao", status: "aguardando_retorno" })).toBe(true);
    expect(canConvertToExchange({ tipo: "troca", status: "aguardando_retorno" })).toBe(false);
    expect(canConvertToExchange({ tipo: "devolucao", status: "concluida" })).toBe(false);
    expect(canConvertToExchange({ tipo: "devolucao", status: "iniciada", voucher_id: "v" })).toBe(false);
    expect(canConvertToExchange({ tipo: "devolucao", status: "iniciada", gateway_refund_id: "g" })).toBe(false);
  });
});
