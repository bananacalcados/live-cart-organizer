import { describe, it, expect } from "vitest";
import { buildDispatchPatch } from "@/lib/pos/markExchangeDispatched";

describe("buildDispatchPatch", () => {
  const now = new Date("2026-11-08T20:00:00Z");
  it("conclui e registra quem/quando, sem rastreio obrigatório", () => {
    const p = buildDispatchPatch({ userId: "u1", now });
    expect(p).toEqual({ status: "concluida", despachada_em: now.toISOString(), despachada_por: "u1" });
  });
  it("grava rastreio e transportadora quando informados", () => {
    const p = buildDispatchPatch({ userId: "u1", now, trackingCode: " AA123BR ", trackingCarrier: "Correios" });
    expect(p.tracking_code).toBe("AA123BR");
    expect(p.tracking_carrier).toBe("Correios");
  });
});
