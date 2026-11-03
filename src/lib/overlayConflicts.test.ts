import { describe, expect, it } from "vitest";
import { hiddenByConflict, overlappingPairs } from "./overlayConflicts";

const r = (x: number, y: number, width = 100, height = 100) => ({ x, y, width, height });

describe("overlay conflicts", () => {
  it("timer wins over shown product when they cross", () => {
    expect([...hiddenByConflict([{ key: "shown_product", rect: r(0, 0) }, { key: "timers", rect: r(50, 50) }])]).toEqual(["shown_product"]);
  });
  it("alert wins over ticker and cta", () => {
    const h = hiddenByConflict([{ key: "cta", rect: r(0, 0) }, { key: "ticker", rect: r(10, 10) }, { key: "alert", rect: r(20, 20) }]);
    expect([...h].sort()).toEqual(["cta", "ticker"]);
  });
  it("blocks touching by only a few pixels both stay visible", () => {
    expect(hiddenByConflict([{ key: "ticker", rect: r(0, 0) }, { key: "cta", rect: r(0, 97) }]).size).toBe(0);
  });
  it("a hidden block does not hide others", () => {
    // wheel hidden by timers; cta crosses only wheel, so cta stays.
    const h = hiddenByConflict([{ key: "timers", rect: r(0, 0) }, { key: "wheel", rect: r(50, 0) }, { key: "cta", rect: r(120, 0) }]);
    expect([...h]).toEqual(["wheel"]);
  });
  it("editor lists overlapping pairs", () => {
    expect(overlappingPairs([{ key: "a", rect: r(0, 0) }, { key: "b", rect: r(50, 50) }, { key: "c", rect: r(500, 500) }])).toEqual([["a", "b"]]);
  });
});
