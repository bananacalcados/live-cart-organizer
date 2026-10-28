import { describe, expect, it } from "vitest";
import { groupJidBase, isGroupChatOwner } from "../../supabase/functions/_shared/group-chat-owner";

const sb = (instance_id: string | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: instance_id ? { instance_id } : null, error: null }) }) }) }),
});

describe("chat de grupo só pela instância responsável", () => {
  it("normaliza o id do grupo removendo sufixos", () => {
    expect(groupJidBase("120363429714380179@g.us")).toBe("120363429714380179");
    expect(groupJidBase("553399999999-1600000000-group")).toBe("553399999999");
  });
  it("instância não responsável não grava o chat", async () => {
    expect(await isGroupChatOwner(sb("A"), "120363@g.us", "B")).toBe(false);
  });
  it("instância responsável grava", async () => {
    expect(await isGroupChatOwner(sb("A"), "120363@g.us", "A")).toBe(true);
  });
  it("sem responsável definida mantém o comportamento antigo", async () => {
    expect(await isGroupChatOwner(sb(null), "120363@g.us", "B")).toBe(true);
  });
});
