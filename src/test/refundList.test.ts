import { describe, expect, it } from "vitest";
import { applyRefundListFilters } from "../../supabase/functions/_shared/refund-list";

function queryRecorder() {
  const calls: unknown[][] = [];
  const q: any = {};
  for (const method of ["in", "eq", "gte", "lte", "order"]) q[method] = (...args: unknown[]) => { calls.push([method, ...args]); return q; };
  return { q, calls };
}

describe("leitura dos estornos para usuários com permissão", () => {
  for (const scope of ["pending", "active", "history"]) {
    it(`não restringe ${scope} por solicitante`, () => {
      const { q, calls } = queryRecorder();
      applyRefundListFilters(q, { scope, requested_by: "outro-usuario", isAdmin: false });
      expect(calls.some((c) => c[1] === "requested_by")).toBe(false);
      expect(calls[0]).toEqual(["in", "status", scope === "pending" ? ["aguardando_aprovacao"] : scope === "active" ? ["processando", "verificar"] : ["concluido", "recusado", "falhou"]]);
    });
  }
  it("preserva todos os concluídos do período e ordenação estável", () => {
    const { q, calls } = queryRecorder();
    applyRefundListFilters(q, { scope: "history", status: "concluido", from: "2026-10-19T03:00:00Z", to: "2026-10-21T02:59:59Z" });
    expect(calls).toEqual([
      ["in", "status", ["concluido"]],
      ["gte", "created_at", "2026-10-19T03:00:00Z"],
      ["lte", "created_at", "2026-10-21T02:59:59Z"],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ]);
  });
});