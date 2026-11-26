import { describe, it, expect, vi } from "vitest";
import { createItemPhotoCache, itemPhotoKey } from "@/lib/pos/itemPhotoCache";

const ph = (k: string) => ({ thumb: `t${k}`, medium: `m${k}`, full: `f${k}` });

describe("item photo cache", () => {
  it("batches a burst of scans into one call and never re-asks cached keys", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter((k) => k !== "x").map((k) => [k, ph(k)])));
    const c = createItemPhotoCache(fetcher, 150);
    c.request(["a"]); c.request(["b", "a"]); c.request(["x"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0].sort()).toEqual(["a", "b", "x"]);
    expect(c.get("a")?.thumb).toBe("ta");
    expect(c.get("x")).toBeNull();
    c.request(["a", "x"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("caps each call at 200 keys", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => ({}));
    const c = createItemPhotoCache(fetcher, 10);
    c.request(Array.from({ length: 250 }, (_, i) => `k${i}`));
    await vi.advanceTimersByTimeAsync(50);
    expect(fetcher.mock.calls.map((x: any) => x[0].length)).toEqual([200, 50]);
    vi.useRealTimers();
  });

  it("a failed photo lookup is silent", async () => {
    vi.useFakeTimers();
    const c = createItemPhotoCache(async () => { throw new Error("down"); }, 10);
    c.request(["a"]);
    await vi.advanceTimersByTimeAsync(50);
    expect(c.get("a")).toBeNull();
    vi.useRealTimers();
  });

  it("uses barcode first, then SKU", () => {
    expect(itemPhotoKey({ barcode: " 789 ", sku: "S1" })).toBe("789");
    expect(itemPhotoKey({ barcode: "", sku: "S1" })).toBe("S1");
  });
});
