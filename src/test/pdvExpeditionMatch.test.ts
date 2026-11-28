import { describe, expect, it, vi } from "vitest";
import { matchExpeditionScan } from "@/lib/pos/expeditionScanMatch";
import type { ExpItem } from "@/lib/pos/expedition";
const item = { id: "item", sale_id: "sale", barcode: "123", sku: "SKU", quantity: 2 } as ExpItem;
const resolved = { code: "T255-38", variant_id: "variant", product_barcode: "123" } as any;
describe("shared desktop/mobile expedition code recognition", () => {
  it("legacy barcode does not call the resolver", async () => {
    const resolver = vi.fn(); expect((await matchExpeditionScan([item], "1 23", () => true, "s", false, resolver)).item).toBe(item); expect(resolver).not.toHaveBeenCalled();
  });
  it("legacy desktop still does not directly accept an unrelated SKU", async () => expect((await matchExpeditionScan([item], "SKU", () => true, "s")).item).toBeUndefined());
  it("mobile scanner accepts SKU through the same matcher", async () => expect((await matchExpeditionScan([item], "SKU", () => true, "s", true)).item).toBe(item));
  it("internal label reuses the existing resolver and barcode match", async () => {
    const resolver = vi.fn().mockResolvedValue(resolved); expect((await matchExpeditionScan([item], "T255-38", () => true, "s", false, resolver)).item).toBe(item); expect(resolver).toHaveBeenCalledWith("T255-38", "s");
  });
  it("extra unit is rejected when no quantity remains", async () => expect((await matchExpeditionScan([item], "123", () => false, "s")).alreadyScanned).toBe(true));
  it("wrong item is rejected without inventing a match", async () => expect((await matchExpeditionScan([item], "000", () => true, "s")).item).toBeUndefined());
});