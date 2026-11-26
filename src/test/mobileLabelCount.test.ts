import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { buildStockLabelItems } from "@/lib/labels/stockLabelBatch";
import { mobileLabelItems, stepQty, confirmRows } from "@/mobile/inventory/labelCount";
import { expandLabels } from "@/lib/labels/labelPdf";

const ids = ["a", "b", "c"];
const qty = { a: "3", b: "", c: "0" };
describe("etiquetas no celular", () => {
  it.each(["print_only", "balance", "add"] as const)("lote igual ao do computador (%s)", (m) => {
    expect(mobileLabelItems(ids, qty, m)).toEqual(buildStockLabelItems(ids, qty, m, "selected"));
    expect(mobileLabelItems(ids, qty, m)).toEqual([{ variant_id: "a", qty: 3 }, { variant_id: "c", qty: 0 }]);
  });
  it("+/- nunca fica negativo", () => {
    expect(stepQty("", 1)).toBe("1"); expect(stepQty("1", -1)).toBe("0"); expect(stepQty("0", -1)).toBe("");
  });
  it("confirmação mostra saldo atual -> novo", () => {
    const pv = { a: { stock: 5, pending: 1, posProductId: null, code: null }, c: { stock: 2, pending: 0, posProductId: null, code: null } };
    const v = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
    expect(confirmRows(v, qty, "balance", pv)).toEqual([{ id: "a", label: "A", before: 5, after: 2 }, { id: "c", label: "C", before: 2, after: 0 }]);
    expect(confirmRows(v, qty, "add", pv)[0].after).toBe(8);
  });
  it("uma etiqueta por cópia, sem código fica fora", () => {
    const l = expandLabels([{ id: "a", code: "X1", color: "Preto", size: "37" }, { id: "b", code: null }], { a: 2, b: 4 }, "Tênis", null);
    expect(l).toHaveLength(2); expect(l[0]).toMatchObject({ code: "X1", variant: "Preto · 37", name: "Tênis" });
  });
});
