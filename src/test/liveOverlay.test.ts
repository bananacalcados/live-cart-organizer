import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_LAYOUT, normalizeOverlayPosition, withOverlayDefaults } from "@/lib/liveOverlay";

describe("overlay layout", () => {
  it("fills missing blocks and individual fields without changing saved text", () => {
    const config = withOverlayDefaults({ layout: { alert: { x: 400, width: 500 } }, ticker: { items: [{ id: "one", text: "Manual", enabled: true }] } });
    expect(config.layout.ticker).toEqual(DEFAULT_OVERLAY_LAYOUT.ticker);
    expect(config.layout.alert).toEqual({ ...DEFAULT_OVERLAY_LAYOUT.alert, x: 400, width: 500 });
    expect(config.ticker.items[0].text).toBe("Manual");
  });
  it("keeps widths, positions and fonts inside the canvas", () => {
    const p = normalizeOverlayPosition({ x: 1000, y: 2000, width: 600, font_size: 300, align: "left" });
    expect(p.x + p.width).toBe(1080);
    expect(p.y).toBeLessThan(1920);
    expect(p.font_size).toBe(160);
    expect(normalizeOverlayPosition({ ...p, width: 0, x: -40 }).x).toBe(0);
  });
  it("ships blocks at roughly double the old text size so the live audience can read them", () => {
    expect(DEFAULT_OVERLAY_LAYOUT.ticker.font_size).toBe(76);
    expect(DEFAULT_OVERLAY_LAYOUT.raffle_bar.font_size).toBe(72);
    expect(DEFAULT_OVERLAY_LAYOUT.alert.font_size).toBe(72);
    expect(DEFAULT_OVERLAY_LAYOUT.cta.font_size).toBe(84);
    expect(DEFAULT_OVERLAY_LAYOUT.wheel.font_size).toBe(108);
  });
});