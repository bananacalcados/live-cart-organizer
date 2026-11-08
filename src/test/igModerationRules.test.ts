import { describe, it, expect } from "vitest";
import { decideModeration, skipReason, buildPrivateReply } from "../../supabase/functions/_shared/ig-moderation-rules";

const on = { enabled: true, class_enabled: { pedido_rastreio: true, acusacao: true, ofensa_spam: true, duvida: true }, acusacao_min_confidence: 0.85 };
const base = { isLive: false, copiedToLive: false, username: "maria", fromId: "1", accountId: "999", ownUsernames: ["bananacalcados"], teamUsernames: ["@atendente"] };

describe("moderação de comentários", () => {
  it("comentário de live nunca entra", () => {
    expect(skipReason({ ...base, isLive: true })).toBe("live");
    expect(skipReason({ ...base, copiedToLive: true })).toBe("copiado_para_live");
  });
  it("própria conta e equipe são ignoradas", () => {
    expect(skipReason({ ...base, username: "BananaCalcados" })).toBe("propria_conta");
    expect(skipReason({ ...base, fromId: "999" })).toBe("propria_conta");
    expect(skipReason({ ...base, username: "atendente" })).toBe("equipe");
    expect(skipReason(base)).toBeNull();
  });
  it("acusação abaixo de 0,85 vira dúvida e não oculta", () => {
    const d = decideModeration("acusacao", 0.7, on);
    expect(d.finalClass).toBe("duvida");
    expect(d.hide).toBe(false);
    expect(decideModeration("acusacao", 0.9, on)).toMatchObject({ hide: true, toContact: true });
  });
  it("rastreio oculta e manda privada; dúvida não oculta", () => {
    expect(decideModeration("pedido_rastreio", 0.6, on)).toMatchObject({ hide: true, privateReply: true });
    expect(decideModeration("duvida", 0.9, on)).toMatchObject({ hide: false, suggestPublicReply: true });
  });
  it("interruptor geral ou da classe desligado não oculta", () => {
    expect(decideModeration("ofensa_spam", 1, { ...on, enabled: false }).hide).toBe(false);
    expect(decideModeration("ofensa_spam", 1, { ...on, class_enabled: { ofensa_spam: false } }).hide).toBe(false);
  });
  it("mensagem privada inclui link de rastreio quando houver", () => {
    expect(buildPrivateReply("Oi, {primeiro_nome}!", "Rastreio: {link_rastreio}", "Ana", "https://x/rastreio/BC-1")).toBe("Oi, Ana!\n\nRastreio: https://x/rastreio/BC-1");
    expect(buildPrivateReply("Oi, {primeiro_nome}!", "Rastreio: {link_rastreio}", "Ana", null)).toBe("Oi, Ana!");
  });
});
