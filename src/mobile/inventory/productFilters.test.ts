import { describe, it, expect, beforeEach } from "vitest";
import { shouldList, loadFilters, saveFilters, rpcParams, categoryChipLabel, mergePage, EMPTY_FILTERS, FILTERS_KEY } from "./productFilters";

describe("filtros do estoque no celular", () => {
  beforeEach(() => localStorage.clear());
  it("sem filtro e sem texto não lista", () => { expect(shouldList(EMPTY_FILTERS, "  ")).toBe(false); });
  it("qualquer filtro ou texto lista", () => {
    expect(shouldList({ ...EMPTY_FILTERS, inStock: true }, "")).toBe(true);
    expect(shouldList({ ...EMPTY_FILTERS, categoryIds: ["c"] }, "")).toBe(true);
    expect(shouldList(EMPTY_FILTERS, "nike")).toBe(true);
  });
  it("paginação de 30 com offset", () => {
    const p = rpcParams({ activeOnly: true, inStock: true, categoryIds: ["a"] }, " nike ", 2);
    expect(p).toMatchObject({ p_term: "nike", p_active_only: true, p_in_stock: true, p_category_ids: ["a"], p_limit: 30, p_offset: 60 });
    expect(rpcParams(EMPTY_FILTERS, "", 0).p_category_ids).toBeNull();
  });
  it("lembra filtros e ignora lixo", () => {
    saveFilters({ activeOnly: true, inStock: false, categoryIds: ["x"] });
    expect(loadFilters()).toEqual({ activeOnly: true, inStock: false, categoryIds: ["x"] });
    localStorage.setItem(FILTERS_KEY, "{quebrado");
    expect(loadFilters()).toEqual(EMPTY_FILTERS);
  });
  it("chip de categoria", () => {
    expect(categoryChipLabel([], {})).toBe("Categoria");
    expect(categoryChipLabel(["a", "b"], { a: "Tênis" })).toBe("Tênis +1");
  });
  it("carregar mais não repete", () => {
    expect(mergePage([{ id: "1" }], [{ id: "1" }, { id: "2" }]).map((x) => x.id)).toEqual(["1", "2"]);
  });
});
