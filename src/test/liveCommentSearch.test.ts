import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearch } from "@/lib/liveCommentSearch";

const comment = { username: "@IaraLduarte", comment_text: "Até agora não me responderam no WhatsApp" };

describe("busca de comentários da live", () => {
  it("normaliza acento, maiúscula e espaços duplicados", () => {
    expect(normalizeSearch("  Até   AGORA ")).toBe("ate agora");
  });

  it("encontra pelo @ mesmo sem acento e com maiúsculas", () => {
    expect(matchesSearch(comment, "iara")).toBe(true);
    expect(matchesSearch(comment, "@IARA")).toBe(true);
    expect(matchesSearch(comment, "@iara lduarte")).toBe(false);
  });

  it("encontra pelo texto ignorando acento", () => {
    expect(matchesSearch(comment, "whatsapp")).toBe(true);
    expect(matchesSearch(comment, "não responderam")).toBe(true);
    expect(matchesSearch(comment, "nao responderam")).toBe(true);
  });

  it("termo com @ procura só no @, não no texto", () => {
    expect(matchesSearch({ username: "@maria", comment_text: "quero o @iara" }, "@iara")).toBe(false);
  });

  it("termo vazio mostra tudo", () => {
    expect(matchesSearch(comment, "   ")).toBe(true);
  });
});
