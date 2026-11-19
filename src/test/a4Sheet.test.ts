import { describe, it, expect } from "vitest";
import { paginate, cellPosition } from "@/lib/labels/a4Sheet";

describe("folha A4 27 etiquetas", () => {
  it("cabem 27 por folha", () => {
    const pages = paginate(Array.from({ length: 28 }, (_, i) => i), 1);
    expect(pages[0].length).toBe(27);
    expect(pages.length).toBe(2);
  });
  it("começar na posição 5 deixa 4 em branco", () => {
    const pages = paginate([1, 2], 5);
    expect(pages[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(pages[0][4]).toBe(1);
  });
  it("última célula cabe na folha com o padrão", () => {
    const p = cellPosition(26, { top: 9, left: 7.2, colGap: 2.5, rowGap: 0 });
    expect(p.x + 63.5).toBeLessThanOrEqual(210);
    expect(p.y + 31).toBeLessThanOrEqual(297);
  });
});

import { LETTER_30, A4_27, sheetCount } from "@/lib/labels/a4Sheet";
const L = LETTER_30.defaultLayout;
describe("folha Carta 30 etiquetas", () => {
  it("1ª célula, 3ª coluna e última linha", () => {
    expect(cellPosition(0, L, LETTER_30)).toEqual({ x: 4.8, y: 12.7 });
    expect(cellPosition(2, L, LETTER_30).x).toBeCloseTo(4.8 + 2 * (66.7 + 3.2), 6);
    expect(cellPosition(27, L, LETTER_30).y).toBeCloseTo(12.7 + 9 * 25.4, 6);
  });
  it("30 por folha, 31 = 2 folhas", () => {
    const pages = paginate(Array.from({ length: 31 }, (_, i) => i), 1, LETTER_30);
    expect(pages[0].length).toBe(30);
    expect(pages.length).toBe(2);
    expect(sheetCount(31, 1, LETTER_30)).toBe(2);
  });
  it("posição 30 deixa 29 em branco", () => {
    const p = paginate([1], 30, LETTER_30)[0];
    expect(p.slice(0, 29).every((c) => c === null)).toBe(true);
    expect(p[29]).toBe(1);
  });
  it("última célula cabe no papel Carta", () => {
    const p = cellPosition(29, L, LETTER_30);
    expect(p.x + 66.7).toBeLessThanOrEqual(215.9);
    expect(p.y + 25.4).toBeLessThanOrEqual(279.4);
  });
});
describe("A4 27 inalterado", () => {
  it("posições idênticas às de antes", () => {
    const l = { top: 9, left: 7.2, colGap: 2.5, rowGap: 0 };
    expect(A4_27.defaultLayout).toEqual(l);
    for (let i = 0; i < 27; i++) {
      const old = { x: 7.2 + (i % 3) * (63.5 + 2.5), y: 9 + Math.floor(i / 3) * 31 };
      expect(cellPosition(i, l)).toEqual(old);
      expect(cellPosition(i, l, A4_27)).toEqual(old);
    }
    expect(paginate([1], 99).length).toBe(1);
    expect(paginate([1], 99)[0].filter((c) => c === null).length).toBe(26);
  });
});
