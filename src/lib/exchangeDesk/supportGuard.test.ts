import { describe, it, expect } from "vitest";
import { supportGuardLines } from "./supportGuard";
const base = { mode: "auto", shadow_auto: false, shadow_reason: null, shadow_at: null, paused: [], triage_total: 0, triage_failed: 0, alert_configured: false };
describe("aviso fixo das travas do suporte", () => {
  it("tudo normal não mostra aviso", () => expect(supportGuardLines(base)).toEqual([]));
  it("sombra manual não mostra aviso", () => expect(supportGuardLines({ ...base, mode: "shadow" })).toEqual([]));
  it("sombra automática mostra o motivo", () => expect(supportGuardLines({ ...base, mode: "shadow", shadow_auto: true, shadow_reason: "falha X", shadow_at: "2026-11-17T12:51:00Z" })[0]).toContain("falha X"));
  it("canal pausado aparece com o nome", () => expect(supportGuardLines({ ...base, paused: [{ id: "1", name: "@bananacalcados", until: "2026-11-17T13:10:00Z", reason: "3 falhas" }] })[0]).toContain("@bananacalcados"));
  it("triagem acima de 50% em 15 min avisa", () => expect(supportGuardLines({ ...base, triage_total: 4, triage_failed: 3 })).toHaveLength(1));
  it("triagem com 50% não avisa", () => expect(supportGuardLines({ ...base, triage_total: 4, triage_failed: 2 })).toHaveLength(0));
});
