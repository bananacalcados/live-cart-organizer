import { describe, it, expect } from "vitest";
import { variantColorLabel, sizeDisplayLabel } from "./expeditionVariantDisplay";

describe("cor e tamanho na Conferência da Expedição", () => {
  it("tira o tamanho colado no fim da cor", () => {
    expect(variantColorLabel("Branco Off / 37", "37")).toBe("Branco Off");
    expect(variantColorLabel("MARROM ESCURO / 41", "41")).toBe("MARROM ESCURO");
    expect(variantColorLabel("Prata | 36", "36")).toBe("Prata");
    expect(variantColorLabel("Preto 38", "38")).toBe("Preto");
  });

  it("mantém a cor inteira quando o final não é o tamanho do item", () => {
    expect(variantColorLabel("Branco Off / 38", "37")).toBe("Branco Off / 38");
    expect(variantColorLabel("Samba 40", "37")).toBe("Samba 40");
    expect(variantColorLabel("Off / White", "37")).toBe("Off / White");
  });

  it("não quebra quando falta um dos campos", () => {
    expect(variantColorLabel("Perola", null)).toBe("Perola");
    expect(variantColorLabel(null, "37")).toBe("");
    expect(variantColorLabel("   ", "37")).toBe("");
    expect(variantColorLabel("37", "37")).toBe("37");
  });

  it("compara tamanhos escritos de formas diferentes", () => {
    expect(variantColorLabel("Prata / 37.0", "37")).toBe("Prata");
    expect(variantColorLabel("Prata / BR37", "37")).toBe("Prata");
  });

  it("avisa quando o item está sem tamanho", () => {
    expect(sizeDisplayLabel("37")).toBe("37");
    expect(sizeDisplayLabel(null)).toBe("SEM TAMANHO");
    expect(sizeDisplayLabel("  ")).toBe("SEM TAMANHO");
  });
});
