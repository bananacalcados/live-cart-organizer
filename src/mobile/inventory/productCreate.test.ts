import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DESKTOP_DEFAULTS, SIZE_GRIDS, buildCombos, validateCreate, emptyMaster, variantsPayload, duplicateIdFrom, labelQuantities, totalPairs, fiscalWarnings, parseQty, stepQty } from "./productCreate";
import { expandLabels } from "@/lib/labels/labelPdf";

const desktop = readFileSync("src/components/inventory/ProductMasterForm.tsx", "utf8");

describe("criar produto pelo celular", () => {
  it("padrões iguais aos do computador", () => {
    expect(desktop).toContain(`useState(initial?.ncm || "${DESKTOP_DEFAULTS.ncm}")`);
    for (const [k, v] of [["Weight", DESKTOP_DEFAULTS.weight], ["Height", DESKTOP_DEFAULTS.height], ["Width", DESKTOP_DEFAULTS.width], ["Length", DESKTOP_DEFAULTS.length]])
      expect(desktop).toContain(`[${k.toLowerCase()}, set${k}] = useState<string>("${v}")`);
  });
  it("grades pedidas", () => {
    expect(SIZE_GRIDS.map((g) => g.label)).toEqual(["33–39", "34–39", "34–40", "35–40", "PP–GG", "Único"]);
    expect(SIZE_GRIDS[1].sizes).toEqual(["34", "35", "36", "37", "38", "39"]);
  });
  it("combinações existentes ficam travadas, sem repetir por acento/maiúscula", () => {
    const c = buildCombos(["Preto", "preto ", "Café"], ["37", "38"], [{ color: "PRETO", size: "37" }, { color: "Cafe", size: "38" }]);
    expect(c.map((x) => `${x.color}-${x.size}-${x.exists}`)).toEqual(["Preto-37-true", "Preto-38-false", "Café-37-false", "Café-38-true"]);
  });
  it("mesmas validações do computador", () => {
    const m = { ...emptyMaster(), name: "X" };
    expect(validateCreate({ ...m, name: " " }, "s", [{ color: "Preto", size: "37", qty: "" }])).toBe("Informe o nome do produto.");
    expect(validateCreate(m, "", [{ color: "Preto", size: "37", qty: "" }])).toMatch(/loja/);
    expect(validateCreate(m, "s", [{ color: "123", size: "37", qty: "" }])).toMatch(/Cor inválida/);
    expect(validateCreate(m, "s", [{ color: "Preto", size: "XYZ", qty: "" }])).toMatch(/Tamanho inválido/);
    expect(validateCreate(m, "s", [{ color: "Preto", size: "ÚNICO", qty: "" }])).toBeNull();
  });
  it("saldo vazio = 0 e +/-", () => {
    expect(parseQty("")).toBe(0); expect(stepQty("", 1)).toBe("1"); expect(stepQty("1", -1)).toBe("");
    expect(variantsPayload([{ color: "Preto", size: "37", qty: "" }, { color: "Preto", size: "38", qty: "3" }], "50", "100").map((v) => v.initial_stock)).toEqual([0, 3]);
  });
  it("preço igual ao pai não vira preço próprio", () => {
    expect(variantsPayload([{ color: "P", size: "37", qty: "", sale: "100" }], "50", "100")[0].sale_price_override).toBeUndefined();
    expect(variantsPayload([{ color: "P", size: "37", qty: "", sale: "120" }], "50", "100")[0].sale_price_override).toBe("120");
  });
  it("aviso fiscal", () => {
    expect(fiscalWarnings({ ...emptyMaster(), costPrice: "10", salePrice: "20" })).toEqual([]);
    expect(fiscalWarnings({ ...emptyMaster(), ncm: "6403" })).toContain("NCM precisa ter 8 dígitos");
  });
  it("nome duplicado vindo do servidor", () => {
    expect(duplicateIdFrom("NOME_DUPLICADO:05209773-556d-4fac-832c-59ba4438c2b0")).toBe("05209773-556d-4fac-832c-59ba4438c2b0");
    expect(duplicateIdFrom("outro erro")).toBeNull();
  });
  it("PDF: uma etiqueta por par lançado", () => {
    const vs = [{ id: "a", color: "Preto", size: "37", code: "C1", qty: 3 }, { id: "b", color: "Preto", size: "38", code: "C2", qty: 2 }, { id: "c", color: "Nude", size: "37", code: "C3", qty: 0 }];
    expect(totalPairs(vs)).toBe(5);
    expect(expandLabels(vs, labelQuantities(vs), "X", 10)).toHaveLength(5);
  });
});
