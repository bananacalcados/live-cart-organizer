import { describe, it, expect } from "vitest";
import { shouldUseMobileInventory } from "./redirect";
describe("desvio do Estoque para o celular", () => {
  it("celular de toque vai para a versão mobile", () => expect(shouldUseMobileInventory({ width: 390, coarse: true, pref: null })).toBe(true));
  it("computador não muda", () => expect(shouldUseMobileInventory({ width: 1280, coarse: false, pref: null })).toBe(false));
  it("janela estreita sem toque não muda", () => expect(shouldUseMobileInventory({ width: 390, coarse: false, pref: null })).toBe(false));
  it("quem escolheu a versão completa fica nela", () => expect(shouldUseMobileInventory({ width: 390, coarse: true, pref: "desktop" })).toBe(false));
});
