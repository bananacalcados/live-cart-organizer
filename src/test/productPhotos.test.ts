import { describe, it, expect } from "vitest";
import { colorSlug, COLOR_KEY_RE, canSeePhotos, parsePhotosMode, validatePhotoFile, photoErrorMessage, parseUploadResponse, reorderPositions } from "@/lib/productPhotos";

describe("productPhotos", () => {
  it("slugs colors to the service format", () => {
    expect(colorSlug("preto")).toBe("preto");
    expect(colorSlug("café")).toBe("cafe");
    expect(colorSlug("branco off")).toBe("branco-off");
    expect(colorSlug("off white")).toBe("off-white");
    expect(colorSlug("", "")).toBe("sem-cor");
    expect(colorSlug("", "Azul Bebê")).toBe("azul-bebe");
    expect(COLOR_KEY_RE.test(colorSlug("a".repeat(80)))).toBe(true);
  });
  it("switch rules", () => {
    expect(canSeePhotos("off", true, true)).toBe(false);
    expect(canSeePhotos("admin", false, true)).toBe(false);
    expect(canSeePhotos("admin", true, false)).toBe(true);
    expect(canSeePhotos("on", false, true)).toBe(true);
    expect(canSeePhotos("on", false, false)).toBe(false);
    expect(parsePhotosMode("x")).toBe("admin");
  });
  it("validates files", () => {
    expect(validatePhotoFile({ type: "image/gif", size: 10 })).not.toBeNull();
    expect(validatePhotoFile({ type: "image/jpeg", size: 16 * 1024 * 1024 })).not.toBeNull();
    expect(validatePhotoFile({ type: "image/webp", size: 1000 })).toBeNull();
  });
  it("translates errors", () => {
    expect(photoErrorMessage(413)).toContain("15 MB");
    expect(photoErrorMessage(422)).toContain("200 px");
    expect(photoErrorMessage(429)).toContain("Espere");
  });
  it("rejects foreign urls", () => {
    const b = "https://fotos.servidorbanana.com/x";
    const id = "a".repeat(32);
    expect(parseUploadResponse({ id, thumb: b, medium: b, full: b })).not.toBeNull();
    expect(parseUploadResponse({ id, thumb: "https://evil.com/x", medium: b, full: b })).toBeNull();
    expect(parseUploadResponse({ id: "bad", thumb: b, medium: b, full: b })).toBeNull();
  });
  it("reorders positions 0..n", () => {
    const r = reorderPositions([{ id: "a" }, { id: "b" }, { id: "c" }], 2, 0);
    expect(r.map((x) => x.id + x.position)).toEqual(["c0", "a1", "b2"]);
  });
});
