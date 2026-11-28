import { describe, expect, it } from "vitest";
import { parsePdvRedirectMode, shouldAutoOpenMobilePdv, shouldShowPdvInvite, PDV_INVITE_DISMISS_MS } from "./redirect";
import { fullVersionUrl, visibleMobileTabs } from "./sections";
import { initialPOSSection } from "@/lib/pos/sectionAccess";

const phone = { width: 390, coarse: true };
const pc = { width: 1280, coarse: false };

describe("convite do PDV no celular", () => {
  it("padrão é desligado", () => {
    expect(parsePdvRedirectMode(undefined)).toBe("off");
    expect(parsePdvRedirectMode("lixo")).toBe("off");
    expect(parsePdvRedirectMode('"invite"')).toBe("invite");
  });
  it("off não mostra nada nem desvia", () => {
    expect(shouldShowPdvInvite(phone, "off", null)).toBe(false);
    expect(shouldAutoOpenMobilePdv({ ...phone, pref: null }, "off")).toBe(false);
  });
  it("invite só em celular e respeita os 7 dias", () => {
    const now = 1_000_000_000_000;
    expect(shouldShowPdvInvite(pc, "invite", null, now)).toBe(false);
    expect(shouldShowPdvInvite(phone, "invite", null, now)).toBe(true);
    expect(shouldShowPdvInvite(phone, "invite", now - 1000, now)).toBe(false);
    expect(shouldShowPdvInvite(phone, "invite", now - PDV_INVITE_DISMISS_MS, now)).toBe(true);
  });
  it("auto respeita quem escolheu a versão completa", () => {
    expect(shouldAutoOpenMobilePdv({ ...phone, pref: null }, "auto")).toBe(true);
    expect(shouldAutoOpenMobilePdv({ ...phone, pref: "desktop" }, "auto")).toBe(false);
    expect(shouldAutoOpenMobilePdv({ ...pc, pref: null }, "auto")).toBe(false);
  });
});

describe("abas e permissões", () => {
  it("só expedição vê só expedição", () => {
    expect(visibleMobileTabs(true)).toEqual(["expedicao"]);
    expect(visibleMobileTabs(false)).toContain("whatsapp");
  });
  it("link da versão completa abre a aba certa", () => {
    expect(fullVersionUrl("whatsapp")).toBe("/pos?section=whatsapp");
    expect(fullVersionUrl("caixa")).toBe("/pos?section=cash");
  });
});

describe("abertura do PDV no computador (antes x depois)", () => {
  it("sem parâmetro continua no Dashboard e os antigos continuam iguais", () => {
    expect(initialPOSSection("")).toBe("dashboard");
    expect(initialPOSSection("?section=expedition")).toBe("expedition");
    expect(initialPOSSection("?section=transfer")).toBe("transfer");
    expect(initialPOSSection("?section=config")).toBe("dashboard"); // config continua exigindo PIN
    expect(initialPOSSection("?section=qualquer")).toBe("dashboard");
  });
  it("aceita as abas abertas pelo celular", () => {
    expect(initialPOSSection("?section=whatsapp")).toBe("whatsapp");
    expect(initialPOSSection("?section=cash")).toBe("cash");
  });
});
