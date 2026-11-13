import { describe, expect, it } from "vitest";
import { centralLinkMessage, centralLinkUrl } from "@/lib/central/staffLinkMessage";

describe("mensagem pronta do link da Central", () => {
  it("troca usa a URL real e o primeiro nome", () => {
    const url = centralLinkUrl("troca", "abc");
    expect(url).toBe("https://checkout.bananacalcados.com.br/central/troca/abc");
    const m = centralLinkMessage("troca", url, "Maria Silva");
    expect(m).toContain("Oi, Maria!");
    expect(m).toContain("sua troca");
    expect(m).toContain(url);
  });
  it("devolução sem nome", () => {
    const m = centralLinkMessage("devolucao", centralLinkUrl("devolucao", "x"), "Cliente");
    expect(m.startsWith("Oi!")).toBe(true);
    expect(m).toContain("sua devolução");
  });
});
