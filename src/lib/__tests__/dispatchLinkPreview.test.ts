import { describe, it, expect } from "vitest";
import { costLine, fillSegments, slotContext } from "../dispatchLinkPublic";

describe("links de disparo — prévia e custo", () => {
  it("custo total = pessoas × preço por mensagem", () => {
    expect(costLine(2456, 0.39)?.replace(/\s/g, " ")).toBe("2.456 mensagens × R$ 0,39 ≈ R$ 957,84");
  });
  it("sem preço não mostra custo", () => {
    expect(costLine(10, null)).toBeNull();
  });
  it("espaço vazio fica marcado e nome usa exemplo", () => {
    const s = fillSegments("body", "Oi {{1}}, veja {{2}}", { body_1: { mode: "__first_name__" }, body_2: { mode: "__static__", staticValue: "" } });
    expect(s[1]).toEqual({ slot: 1, value: "Maria", example: true });
    expect(s[3]).toEqual({ slot: 2, value: null, example: false });
  });
  it("trecho em volta do espaço", () => {
    const t = { name: "x", language: "pt_BR", variable_keys: ["body_1"], components: [{ type: "BODY", text: "Olá {{1}}, temos novidades" }] };
    expect(slotContext(t, "body_1")).toBe("Olá ___, temos novidades");
  });
});
