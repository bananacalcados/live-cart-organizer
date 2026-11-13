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
