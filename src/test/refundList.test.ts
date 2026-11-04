import { describe, expect, it } from "vitest";
import { applyRefundListFilters } from "../../supabase/functions/_shared/refund-list";

function queryRecorder() {
  const calls: unknown[][] = [];
  const q: any = {};
  for (const method of ["in", "eq", "gte", "lte", "or", "order"]) q[method] = (...args: unknown[]) => { calls.push([method, ...args]); return q; };
  return { q, calls };
}

describe("leitura dos estornos para usuários com permissão", () => {
  for (const scope of ["pending", "active", "history"]) {
    it(`não restringe ${scope} por solicitante`, () => {
      const { q, calls } = queryRecorder();
      applyRefundListFilters(q, { scope, requested_by: "outro-usuario", isAdmin: false });
      expect(calls.some((c) => c[1] === "requested_by")).toBe(false);
      expect(calls[0]).toEqual(["in", "status", scope === "pending" ? ["aguardando_aprovacao"] : scope === "active" ? ["processando", "verificar"] : ["concluido", "concluido_manual", "recusado"]]);
    });
  }
  it("preserva todos os concluídos do período e ordenação estável", () => {
    const { q, calls } = queryRecorder();
    applyRefundListFilters(q, { scope: "history", status: "concluido", from: "2026-10-19T03:00:00Z", to: "2026-10-21T02:59:59Z" });
    expect(calls).toEqual([
      ["in", "status", ["concluido","concluido_manual"]],
      ["or", "and(completed_at.gte.2026-10-19T03:00:00.000Z,completed_at.lte.2026-10-21T02:59:59.000Z),and(completed_at.is.null,approved_at.gte.2026-10-19T03:00:00.000Z,approved_at.lte.2026-10-21T02:59:59.000Z),and(completed_at.is.null,approved_at.is.null,created_at.gte.2026-10-19T03:00:00.000Z,created_at.lte.2026-10-21T02:59:59.000Z)"],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ]);
  });
  it('mostrar falhas inclui registros antigos sem apagar',()=>{const {q,calls}=queryRecorder();applyRefundListFilters(q,{scope:'history',show_failures:true});expect(calls[0]).toEqual(['in','status',['concluido','concluido_manual','recusado','falhou']]);});
  it("estorno pedido dia 30 e feito hoje entra no filtro de hoje (pela data de conclusão)", () => {
    const { q, calls } = queryRecorder();
    applyRefundListFilters(q, { scope: "history", from: "2026-11-04T03:00:00Z" });
    expect(String(calls[1][1])).toContain("completed_at.gte.2026-11-04T03:00:00.000Z");
  });
  it("lista de falhas traz só os que deram erro", () => {
    const { q, calls } = queryRecorder();
    applyRefundListFilters(q, { scope: "failed" });
    expect(calls[0]).toEqual(["in", "status", ["falhou"]]);
  });
});
