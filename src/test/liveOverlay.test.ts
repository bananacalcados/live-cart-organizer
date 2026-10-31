import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_LAYOUT, normalizeOverlayPosition, withOverlayDefaults, overlayEventChanged } from "@/lib/liveOverlay";

describe("fixed overlay live selection", () => {
  it("resets the cursor only when the fixed link moves to another live", () => {
    expect(overlayEventChanged("live-29-10", "live-31-10")).toBe(true);
    expect(overlayEventChanged("live-29-10", "live-29-10")).toBe(false);
    expect(overlayEventChanged(null, "live-29-10")).toBe(false);
    expect(overlayEventChanged("live-29-10", null)).toBe(false);
  });
  it("preserves the last live's custom sizes and positions rather than restoring defaults", () => {
    const layout = { ticker: { x: 24.444580078125, y: 83.33333333333333, width: 1040, font_size: 48, align: "center" }, wheel: { x: 22.222086588541664, y: 824.4447835286458, width: 1040, font_size: 91, align: "center" } };
    const config = withOverlayDefaults({ layout });
    expect(config.layout.ticker).toEqual(layout.ticker);
    expect(config.layout.wheel).toEqual(layout.wheel);
  });
});

describe("overlay layout", () => {
  it("preserves saved fictional participants independently of real raffle entries", () => {
    const handles = "@llarissalaura\n@elanenavegante\n@jessicamarianer\n@werlic.gabii";
    const config = withOverlayDefaults({ wheel: { test_handles: handles, enabled: false } });
    expect(config.wheel.test_handles).toBe(handles);
    expect(config.wheel.enabled).toBe(false);
    expect(config.layout.wheel).toEqual(DEFAULT_OVERLAY_LAYOUT.wheel);
  });
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
import { formatTimer, takeNextTimer, timerShowSeconds } from "@/lib/liveOverlay";
describe("payment timers", () => {
  it("formats remaining time as mm:ss and never goes negative", () => {
    expect(formatTimer(125_000)).toBe("02:05");
    expect(formatTimer(-5)).toBe("00:00");
  });
  it("shows one at a time in arrival order, skipping expired and older than 20 min", () => {
    const now = 1_000_000_000;
    const mk = (id: string, exp: number, added = now) => ({ orderId: id, handle: id, product: "", size: "", expiresAt: now + exp, addedAt: added });
    const queue = [mk("c", -1), mk("old", 5_000, now - 21 * 60_000), mk("a", 50_000), mk("b", 10_000)];
    const first = takeNextTimer(queue, now);
    expect(first.next?.orderId).toBe("a");
    expect(first.rest.map((t) => t.orderId)).toEqual(["b"]);
    expect(takeNextTimer(first.rest, now).next?.orderId).toBe("b");
    expect(takeNextTimer([], now).next).toBeNull();
  });
  it("uses the configured on-screen time, never under 2 s", () => {
    expect(timerShowSeconds({ enabled: true, template: "", duration_seconds: 4 })).toBe(4);
    expect(timerShowSeconds({ enabled: true, template: "", duration_seconds: 0 })).toBe(6);
    expect(timerShowSeconds({ enabled: true, template: "", duration_seconds: 1 })).toBe(2);
  });
});
import { DEFAULT_OVERLAY_CONFIG, expiredAlertTemplate } from "@/lib/liveOverlay";
describe("expired alert", () => {
  it("uses the 'liberou' text when there is another pair and the 'prazo acabou' text when not", () => {
    const c = DEFAULT_OVERLAY_CONFIG.expired_alert;
    expect(expiredAlertTemplate(c, {})).toBe("🔁 Liberou o {size} do {product}! Quem quer?");
    expect(expiredAlertTemplate(c, { has_stock: false })).toBe("⌛ @{handle}, o prazo da bolsa acabou!");
  });
});
