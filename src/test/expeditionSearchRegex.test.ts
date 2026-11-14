import { describe, expect, it } from "vitest";
import { accentInsensitiveRegex } from "@/components/pos/expedition/expeditionTypes";

const matches = (term: string, name: string) => new RegExp(accentInsensitiveRegex(term), "i").test(name);

describe("busca de cliente nos Concluídos da Expedição", () => {
  it("acha Márcia digitando com ou sem acento e com maiúsculas misturadas", () => {
    for (const t of ["már", "marcia", "márcia", "mÁRCIA", "MARCIA"]) {
      expect(matches(t, "Márcia Regina Tavares da Silva")).toBe(true);
    }
  });
  it("não acha nomes que só parecem (Marina não é Márcia)", () => {
    expect(matches("márcia", "Marina Camacho Beckert")).toBe(false);
  });
  it("aceita partes do nome separadas", () => {
    expect(matches("marcia silva", "Márcia Regina Tavares da Silva")).toBe(true);
  });
});
