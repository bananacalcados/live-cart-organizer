import { describe, expect, it } from "vitest";
import { compareLiveContacts, isLiveContactUnread } from "@/lib/liveContactUnread";

const first = "2026-10-24T16:54:00Z";
const next = "2026-10-24T16:55:00Z";
describe("não lidas em Novos Contatos", () => {
  it("mensagem recebida não visualizada fica não lida", () => {
    expect(isLiveContactUnread({ lastIn: first, lastOut: null })).toBe(true);
    expect(isLiveContactUnread({ lastIn: null, lastOut: null })).toBe(false);
  });
  it("marcar como lido remove o destaque e nova mensagem o devolve", () => {
    const seenAt = Date.parse(first);
    expect(isLiveContactUnread({ lastIn: first, lastOut: null }, seenAt)).toBe(false);
    expect(isLiveContactUnread({ lastIn: next, lastOut: null }, seenAt)).toBe(true);
  });
  it("resposta posterior mantém o comportamento de leitura existente", () => {
    expect(isLiveContactUnread({ lastIn: first, lastOut: next })).toBe(false);
  });
  it("prioriza não lidas pela mensagem mais recente, não pela data de cadastro", () => {
    const olderContact = { key: "older", unread: true, lastIncomingAt: next, createdAt: first };
    const newerContact = { key: "newer", unread: true, lastIncomingAt: first, createdAt: next };
    const readContact = { key: "read", unread: false, lastIncomingAt: next, createdAt: next };
    expect([readContact, newerContact, olderContact].sort(compareLiveContacts).map((c) => c.key)).toEqual(["older", "newer", "read"]);
  });
});