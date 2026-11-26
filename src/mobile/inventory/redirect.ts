export const MOBILE_PREF_KEY = "inventory_view_pref"; // "desktop" = usuária escolheu versão completa
export const INVITE_DISMISS_KEY = "inventory_mobile_invite_dismissed_at";
export const INVITE_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
export type MobileRedirectMode = "invite" | "auto" | "off";

export function parseRedirectMode(v: unknown): MobileRedirectMode {
  const s = typeof v === "string" ? v.replace(/"/g, "") : v;
  return s === "auto" || s === "off" || s === "invite" ? s : "invite";
}

export function isMobileDevice(env: { width: number; coarse: boolean }) { return env.coarse && env.width < 768; }

export function shouldUseMobileInventory(env: { width: number; coarse: boolean; pref: string | null }, mode: MobileRedirectMode = "auto"): boolean {
  if (mode !== "auto" || env.pref === "desktop") return false;
  return isMobileDevice(env);
}

export function shouldShowInvite(env: { width: number; coarse: boolean }, mode: MobileRedirectMode, dismissedAt: number | null, now = Date.now()): boolean {
  if (mode !== "invite" || !isMobileDevice(env)) return false;
  return !dismissedAt || now - dismissedAt >= INVITE_DISMISS_MS;
}

export function readEnv() {
  let pref: string | null = null;
  try { pref = localStorage.getItem(MOBILE_PREF_KEY); } catch { /* ignore */ }
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return { width: window.innerWidth, coarse, pref };
}

export function readInviteDismissed(): number | null {
  try { const v = Number(localStorage.getItem(INVITE_DISMISS_KEY)); return v > 0 ? v : null; } catch { return null; }
}
export function dismissInvite(now = Date.now()) { try { localStorage.setItem(INVITE_DISMISS_KEY, String(now)); } catch { /* ignore */ } }

export function setDesktopPreference(desktop: boolean) {
  try { desktop ? localStorage.setItem(MOBILE_PREF_KEY, "desktop") : localStorage.removeItem(MOBILE_PREF_KEY); } catch { /* ignore */ }
}
