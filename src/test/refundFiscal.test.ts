import { describe, expect, it, vi } from "vitest";
import { checkRefundFiscal, refundFiscalDecision, type RefundFiscalFacts } from "../../supabase/functions/_shared/refund-fiscal";
const ready: RefundFiscalFacts = { sale_id: "sale", registered: true, received: true, return_note_ready: true, active_sale_note: true, sale_note_over_24h: false };
describe("trava fiscal antes do estorno", () => {
  it.each(["integral", "parcial"])("devolução %s exige registro", () => expect(refundFiscalDecision({ ...ready, registered: false }, "devolucao").allowed).toBe(false));
  it("exige produto recebido ou conferido", () => expect(refundFiscalDecision({ ...ready, received: false }, "devolucao").allowed).toBe(false));
  it("exige nota autorizada ou em emissão", () => expect(refundFiscalDecision({ ...ready, return_note_ready: false }, "devolucao").allowed).toBe(false));
  it("libera devolução regular", () => expect(refundFiscalDecision(ready, "devolucao").allowed).toBe(true));
  it("não-admin não força", () => expect(refundFiscalDecision({ ...ready, received: false }, "devolucao", false, true, "reclamação no banco").allowed).toBe(false));
  it("admin precisa motivo", () => expect(refundFiscalDecision(ready, "devolucao", true, true, " ").allowed).toBe(false));
  it("admin pode forçar com motivo obrigatório", () => expect(refundFiscalDecision({ ...ready, received: false }, "devolucao", true, true, "cliente reclamou no banco").overridden).toBe(true));
  it("duplicidade e outros motivos não bloqueados", () => expect(refundFiscalDecision({ ...ready, registered: false, received: false, return_note_ready: false }, "outro").allowed).toBe(true));
  it("cancelamento com nota ativa exige devolução ou cancelamento fiscal", () => expect(refundFiscalDecision({ ...ready, registered: false }, "cancelamento_antes_envio").allowed).toBe(false));
  it("nota cancelada libera cancelamento", () => expect(refundFiscalDecision({ ...ready, registered: false, active_sale_note: false }, "cancelamento_antes_envio").allowed).toBe(true));
  it("aviso de nota de entrada somente após 24h", () => {
    const base = { ...ready, registered: false, return_note_ready: false };
    expect(refundFiscalDecision({ ...base, sale_note_cancellable: true }, "cancelamento_antes_envio").warning).toBeNull();
    expect(refundFiscalDecision({ ...base, sale_note_over_24h: true }, "cancelamento_antes_envio").warning).toContain("nota de entrada");
  });
  const notShipped = { ...ready, registered: false, return_note_ready: false, received: false, shipped: false };
  it("não despachado e sem nota: estorno direto, sem devolução", () => {
    const r = refundFiscalDecision({ ...notShipped, active_sale_note: false }, "cancelamento_antes_envio");
    expect(r.allowed).toBe(true); expect(r.step).toBe("estorno_direto");
  });
  it("não despachado com nota < 24h: cancelar a nota primeiro", () => {
    const r = refundFiscalDecision({ ...notShipped, sale_note_cancellable: true }, "cancelamento_antes_envio");
    expect(r.allowed).toBe(false); expect(r.step).toBe("cancelar_nota");
  });
  it("não despachado com nota > 24h: só admin com motivo", () => {
    const f = { ...notShipped, sale_note_over_24h: true };
    expect(refundFiscalDecision(f, "cancelamento_antes_envio").step).toBe("nota_entrada_admin");
    expect(refundFiscalDecision(f, "cancelamento_antes_envio", false, true, "cliente desistiu").allowed).toBe(false);
    expect(refundFiscalDecision(f, "cancelamento_antes_envio", true, true, "cliente desistiu").allowed).toBe(true);
  });
  it("já despachado: vira devolução", () => {
    const r = refundFiscalDecision({ ...notShipped, active_sale_note: false, shipped: true }, "cancelamento_antes_envio");
    expect(r.allowed).toBe(false); expect(r.step).toBe("devolucao");
  });
  it("simulação consulta somente dados, sem gateway nem SEFAZ", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...ready, received: false } });
    const result = await checkRefundFiscal({ rpc }, "pos_sale", "sale", "devolucao");
    expect(result.allowed).toBe(false);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("refund_return_facts", { p_source: "pos_sale", p_id: "sale" });
  });
  it("falha da consulta bloqueia mesmo admin", async () => {
    await expect(checkRefundFiscal({ rpc: async () => ({ error: {} }) }, "pos_sale", "sale", "devolucao", true, true, "banco")).rejects.toThrow("não autorizado");
  });
});