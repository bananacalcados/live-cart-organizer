import { describe, it, expect } from "vitest";
import { exchangeLockFor } from "@/lib/pos/exchangeReplacementLock";
const base = { pedido_novo_id: "s", codigo_devolucao: "TD1", modo_expedicao: "aguarda_retorno" };
describe("trava do produto da troca na Expedição", () => {
  it("troca aguardando retorno: não exclui e não conclui", () => {
    expect(exchangeLockFor({ ...base, status: "aguardando_retorno" })).toEqual({ code: "TD1", canDelete: false, canConclude: false });
  });
  it("troca finalizada no PDV (aguardando envio): conclui, mas não exclui", () => {
    expect(exchangeLockFor({ ...base, status: "aguardando_envio" })).toMatchObject({ canDelete: false, canConclude: true });
  });
  it("despacho antecipado: pode concluir antes do retorno", () => {
    expect(exchangeLockFor({ ...base, modo_expedicao: "despacho_antecipado", status: "aguardando_retorno" })?.canConclude).toBe(true);
  });
  it("troca cancelada libera a exclusão", () => {
    expect(exchangeLockFor({ ...base, status: "cancelada" })).toBeNull();
  });
});
