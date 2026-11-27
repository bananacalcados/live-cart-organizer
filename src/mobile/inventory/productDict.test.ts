import { describe, it, expect } from "vitest";
import { dictKey, findEquivalent, sortSizes, gridPreselect, uniqueByKey } from "./productCreate";

describe("dicionário de cores e tamanhos no celular", () => {
  it("equivalência de tamanho ignora espaço, maiúscula e hífen", () => {
    const d = ["33/34", "35/36", "37", "M", "ÚNICO"];
    expect(findEquivalent(d, "33-34")).toBe("33/34");
    expect(findEquivalent(d, " 35 / 36 ")).toBe("35/36");
    expect(findEquivalent(d, "m")).toBe("M");
    expect(findEquivalent(d, "unico")).toBe("ÚNICO");
    expect(findEquivalent(d, "38")).toBeNull();
  });
  it("equivalência de cor ignora acento, maiúscula e espaços", () => {
    const d = ["Café", "Off White", "Preto"];
    expect(findEquivalent(d, "cafe")).toBe("Café");
    expect(findEquivalent(d, "OFFWHITE")).toBe("Off White");
    expect(findEquivalent(d, "Azul")).toBeNull();
    expect(uniqueByKey(["Preto", "preto ", "PRETO", "Café", "cafe"])).toEqual(["Preto", "Café"]);
    expect(dictKey("Off  White")).toBe(dictKey("offwhite"));
  });
  it("ordem natural dos tamanhos", () => {
    expect(sortSizes(["GG", "35/36", "34", "Único", "33/34", "P", "35", "33", "M", "PP", "G", "XYZ"]))
      .toEqual(["33", "33/34", "34", "35", "35/36", "PP", "P", "M", "G", "GG", "Único", "XYZ"]);
  });
  it("atalhos marcam só o que existe no cadastro", () => {
    const d = ["33", "34", "35", "36", "37", "P", "m", "G"];
    expect(gridPreselect(d, ["33", "34", "35", "36", "37", "38", "39"])).toEqual(["33", "34", "35", "36", "37"]);
    expect(gridPreselect(d, ["PP", "P", "M", "G", "GG"])).toEqual(["P", "m", "G"]);
    expect(gridPreselect(d, ["ÚNICO"])).toEqual([]);
  });
});
