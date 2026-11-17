import { describe, it, expect } from "vitest";
import { isPostingOverdue, canAddReplacement, canCancelExchange } from "@/lib/pos/exchangeInProgress";
const d = new Date("2026-11-17T15:00:00Z");
describe("troca em andamento", () => {
  it("prazo vencido só quando reversa venceu e produto não voltou", () => {
    expect(isPostingOverdue("aguardando_retorno", "2026-11-16", d)).toBe(true);
    expect(isPostingOverdue("aguardando_retorno", "2026-11-17", d)).toBe(false);
    expect(isPostingOverdue("recebido_conferencia", "2026-11-01", d)).toBe(false);
  });
  it("adicionar produto só em troca aberta sem produto", () => {
    expect(canAddReplacement({ tipo: "troca", status: "iniciada", pedido_novo_id: null })).toBe(true);
    expect(canAddReplacement({ tipo: "troca", status: "iniciada", pedido_novo_id: "x" })).toBe(false);
    expect(canAddReplacement({ tipo: "devolucao", status: "iniciada", pedido_novo_id: null })).toBe(false);
    expect(canAddReplacement({ tipo: "troca", status: "aguardando_envio", pedido_novo_id: null })).toBe(false);
  });
  it("cancelar bloqueado com voucher/estorno ou após finalizar", () => {
    expect(canCancelExchange({ status: "aguardando_retorno" })).toBe(true);
    expect(canCancelExchange({ status: "aguardando_retorno", voucher_id: "v" })).toBe(false);
    expect(canCancelExchange({ status: "aguardando_envio" })).toBe(false);
  });
});
