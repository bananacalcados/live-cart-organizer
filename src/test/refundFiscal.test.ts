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
  it("aviso somente após 24h", () => {
    expect(refundFiscalDecision(ready, "cancelamento_antes_envio").warning).toBeNull();
    expect(refundFiscalDecision({ ...ready, sale_note_over_24h: true }, "cancelamento_antes_envio").warning).toContain("24 horas");
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