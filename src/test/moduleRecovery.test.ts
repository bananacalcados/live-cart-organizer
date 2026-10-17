import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isModuleLoadError, recoverModuleLoad } from "@/lib/moduleRecovery";
describe("module recovery", () => {
 const reload = vi.fn();
 beforeEach(() => { reload.mockClear(); sessionStorage.clear(); vi.stubGlobal("window", { location: { reload } }); });
 afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
 it("recognizes stale dev and production imports", () => {
  expect(isModuleLoadError(new Error("Failed to fetch dynamically imported module: /src/App.tsx?t=123"))).toBe(true);
  expect(isModuleLoadError(new Error("Failed to fetch dynamically imported module: /assets/App-old.js"))).toBe(true);
  expect(isModuleLoadError(new Error("Invalid customer"))).toBe(false);
 });
 it("reloads only once per tab", () => {
  const error = new Error("Failed to fetch dynamically imported module");
  expect(recoverModuleLoad(error)).toBe(true);
  expect(recoverModuleLoad(error)).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
 });
 it("does not reload offline", () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  expect(recoverModuleLoad(new Error("Loading chunk failed"))).toBe(false);
  expect(reload).not.toHaveBeenCalled();
 });
 it("avoids loops when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  expect(recoverModuleLoad(new Error("Loading chunk failed"))).toBe(false);
  expect(reload).not.toHaveBeenCalled();
 });
});
