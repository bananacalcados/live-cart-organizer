import { describe, it, expect } from "vitest";
import { INVITE_DISMISS_MS, parseRedirectMode, shouldShowInvite, shouldUseMobileInventory } from "./redirect";
const phone = { width: 390, coarse: true, pref: null };
const pc = { width: 1280, coarse: false, pref: null };
describe("Estoque no celular: convite e desvio", () => {
  it("padrão é convite (sem configuração ou valor estranho)", () => { expect(parseRedirectMode(undefined)).toBe("invite"); expect(parseRedirectMode("xx")).toBe("invite"); expect(parseRedirectMode('"auto"')).toBe("auto"); });
  it("no modo convite o celular NÃO é desviado", () => expect(shouldUseMobileInventory(phone, "invite")).toBe(false));
  it("no modo convite o celular vê a faixa", () => expect(shouldShowInvite(phone, "invite", null)).toBe(true));
  it("computador nunca vê faixa nem desvio", () => { expect(shouldShowInvite(pc, "invite", null)).toBe(false); expect(shouldUseMobileInventory(pc, "auto")).toBe(false); });
  it("janela estreita sem toque não muda", () => expect(shouldShowInvite({ width: 390, coarse: false }, "invite", null)).toBe(false));
  it("dispensar esconde por 7 dias e volta depois", () => {
    const now = 1_000_000_000_000;
    expect(shouldShowInvite(phone, "invite", now - INVITE_DISMISS_MS + 1000, now)).toBe(false);
    expect(shouldShowInvite(phone, "invite", now - INVITE_DISMISS_MS, now)).toBe(true);
  });
  it("modo automático desvia o celular", () => expect(shouldUseMobileInventory(phone, "auto")).toBe(true));
  it("automático respeita quem escolheu a versão completa", () => expect(shouldUseMobileInventory({ ...phone, pref: "desktop" }, "auto")).toBe(false));
  it("off: nem faixa nem desvio", () => { expect(shouldShowInvite(phone, "off", null)).toBe(false); expect(shouldUseMobileInventory(phone, "off")).toBe(false); });
});
