import { describe, it, expect } from "vitest";
import { isLiveSaleCountable } from "@/lib/pos/commissionSales";
const S = "2026-10-01T03:00:00.000Z", E = "2026-11-01T02:59:59.999Z";
describe("venda de live só conta com expedição concluída no período", () => {
  it("live em conferência não conta", () => expect(isLiveSaleCountable({ event_id: "e", expedition_stage: "conferencia" }, S, E)).toBe(false));
  it("live concluída em outubro conta em outubro", () => expect(isLiveSaleCountable({ event_id: "e", expedition_stage: "concluido", expedition_finished_at: "2026-10-15T12:00:00Z" }, S, E)).toBe(true));
  it("live concluída em novembro não conta em outubro", () => expect(isLiveSaleCountable({ event_id: "e", expedition_stage: "concluido", expedition_finished_at: "2026-11-02T12:00:00Z" }, S, E)).toBe(false));
  it("venda sem live não depende da expedição", () => expect(isLiveSaleCountable({ event_id: null }, S, E)).toBe(true));
});
