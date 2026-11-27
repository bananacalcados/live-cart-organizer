import { describe, it, expect } from "vitest";
import { addScan, emptyScan, undoLast, setQty, pendingItems, markSent, pendingCount, confirmMatches, addUnknown, totalPairs } from "@/mobile/inventory/scanQueue";

const info = { name: "Tênis", color: "Preto", size: "37" };
describe("fila do balanço por bipagem", () => {
  it("soma bipes e desfaz o último", () => {
    let s = addScan(addScan(emptyScan(), "v1", info), "v1", info);
    expect(s.entries.v1.qty).toBe(2);
    s = undoLast(s);
    expect(s.entries.v1.qty).toBe(1);
  });
  it("envia só o que mudou desde o último envio confirmado", () => {
    let s = addScan(addScan(emptyScan(), "v1", info), "v2", info);
    const first = pendingItems(s);
    expect(first.map((i) => i.variant_id)).toEqual(["v1", "v2"]);
    s = markSent(s, first);
    expect(pendingItems(s)).toEqual([]);
    s = addScan(s, "v2", info);
    expect(pendingItems(s).map((i) => [i.variant_id, i.qty])).toEqual([["v2", 2]]);
  });
  it("reenvio manda o total acumulado (não duplica)", () => {
    let s = addScan(emptyScan(), "v1", info);
    s = addScan(s, "v1", info);
    expect(pendingItems(s)[0].qty).toBe(2);
    expect(pendingItems(s)[0].qty).toBe(2);
  });
  it("bipe feito durante o envio continua pendente", () => {
    let s = addScan(emptyScan(), "v1", info);
    const sent = pendingItems(s);
    s = addScan(s, "v1", info);
    s = markSent(s, sent);
    expect(pendingCount(s)).toBe(1);
  });
  it("editar quantidade e não reconhecidos", () => {
    let s = setQty(addScan(emptyScan(), "v1", info), "v1", 7);
    s = addUnknown(addUnknown(s, "X"), "X");
    expect(totalPairs(s)).toBe(7); expect(s.unknown.X).toBe(2);
  });
  it("confirmação exige o número exato de pares", () => {
    expect(confirmMatches("12", 12)).toBe(true);
    expect(confirmMatches("11", 12)).toBe(false);
    expect(confirmMatches("", 0)).toBe(false);
  });
});
