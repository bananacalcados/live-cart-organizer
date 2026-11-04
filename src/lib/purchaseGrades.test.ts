import { describe, it, expect } from "vitest";
import { pairsPerGrade, totalPairs, parseGradeSizes } from "./purchaseGrades";

const grade = [
  { size: "34", qty: 1 }, { size: "35", qty: 2 }, { size: "36", qty: 3 },
  { size: "37", qty: 3 }, { size: "38", qty: 2 }, { size: "39", qty: 1 },
];

describe("grades de compra", () => {
  it("pares da grade somam os tamanhos", () => {
    expect(pairsPerGrade(grade)).toBe(12);
  });
  it("total de pares = grades × pares da grade", () => {
    expect(totalPairs(grade, 3)).toBe(36);
  });
  it("tamanho sem quantidade conta 1 par", () => {
    expect(parseGradeSizes("34, 35:2, 36")).toEqual([
      { size: "34", qty: 1 }, { size: "35", qty: 2 }, { size: "36", qty: 1 },
    ]);
  });
});
