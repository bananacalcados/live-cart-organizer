import { describe, expect, it } from "vitest";
import { activeScans, acknowledgeScans, scanBatch, scanTotals, type LocalExpeditionScan } from "@/lib/pos/expeditionOutbox";
const row: LocalExpeditionScan = { id: "scan-1", sale_id: "sale", sale_item_id: "item", method: "codigo_antigo", code_read: "123", acknowledged: false, snapshot: "v1" };
describe("mobile scan outbox rules", () => {
  it("offline and reconnect reuse the same scan identifier", () => {
    expect(scanBatch([row])[0].id).toBe("scan-1");
    expect(scanBatch([row])[0].id).toBe("scan-1");
    expect(scanBatch(acknowledgeScans([row], ["scan-1"]))).toEqual([]);
  });
  it("two units produce X of Y, not a boolean per SKU", () => expect(scanTotals([row, { ...row, id: "scan-2" }], "v1")).toEqual({ item: 2 }));
  it("undo last scan subtracts one and uploads its own audit record", () => {
    const undo: LocalExpeditionScan = { ...row, id: "undo-1", method: "desfeito", undo_of: row.id };
    expect(scanTotals([row, { ...row, id: "scan-2" }, undo], "v1")).toEqual({ item: 1 });
    expect(scanBatch([row, undo]).map(entry => entry.method)).toEqual(["codigo_antigo", "desfeito"]);
  });
  it("old order snapshot cannot count toward a new conference", () => expect(activeScans([row], "v2")).toEqual([]));
  it("offline unresolved label stays pending and cannot upload an invented item", () => {
    expect(scanBatch([{ ...row, sale_item_id: undefined }])).toEqual([]);
    expect(scanTotals([{ ...row, sale_item_id: undefined }], "v1")).toEqual({});
  });
  it("failed label cannot count or upload", () => {
    const invalid = { ...row, error: "Item errado" };
    expect(scanBatch([invalid])).toEqual([]); expect(scanTotals([invalid], "v1")).toEqual({});
  });
  it("only acknowledged IDs leave the pending queue", () => {
    const rows = acknowledgeScans([row, { ...row, id: "scan-2" }], ["scan-1"]);
    expect(scanBatch(rows).map(entry => entry.id)).toEqual(["scan-2"]);
  });
  it("upload batches have a 100 row ceiling", () => expect(scanBatch(Array.from({ length: 101 }, (_, i) => ({ ...row, id: `scan-${i}` })))).toHaveLength(100));
});