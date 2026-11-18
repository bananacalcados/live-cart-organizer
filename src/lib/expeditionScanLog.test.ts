import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, insert } = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import { logExpeditionScan } from "@/lib/expeditionScanLog";

beforeEach(() => {
  vi.restoreAllMocks();
  from.mockReset();
  insert.mockReset();
  from.mockReturnValue({ insert });
});

describe("registro silencioso da expedição", () => {
  it("usa quantidade padrão 1 e não envia operador nem data", () => {
    insert.mockReturnValue(Promise.resolve({ error: null }));
    logExpeditionScan({ flow: "pos", stage: "conferencia", method: "codigo_antigo", code_read: "123" });
    expect(insert).toHaveBeenCalledWith({ flow: "pos", stage: "conferencia", method: "codigo_antigo", code_read: "123", quantity: 1 });
    expect(insert.mock.calls[0][0]).not.toHaveProperty("operator_id");
    expect(insert.mock.calls[0][0]).not.toHaveProperty("created_at");
  });

  it("preserva a quantidade confirmada", () => {
    insert.mockReturnValue(Promise.resolve({ error: null }));
    logExpeditionScan({ flow: "pos", stage: "conferencia", method: "manual", quantity: 2 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, method: "manual" }));
  });

  it("erro retornado pelo insert só gera aviso no console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    insert.mockReturnValue(Promise.resolve({ error: new Error("indisponível") }));
    expect(() => logExpeditionScan({ flow: "beta", stage: "embalagem", method: "etiqueta_nova" })).not.toThrow();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });

  it("rejeição e falha síncrona não escapam para a tela", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    insert.mockReturnValue(Promise.reject(new Error("offline")));
    expect(() => logExpeditionScan({ flow: "classica", stage: "separacao", method: "manual" })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    from.mockImplementation(() => { throw new Error("sem cliente"); });
    expect(() => logExpeditionScan({ flow: "pos", stage: "conferencia", method: "vincular" })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
