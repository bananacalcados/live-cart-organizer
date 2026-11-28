import { isMobileDevice } from "@/mobile/inventory/redirect";

export const PDV_INVITE_DISMISS_KEY = "pdv_mobile_invite_dismissed_at";
export const PDV_INVITE_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
export const PDV_VIEW_PREF_KEY = "pdv_view_pref"; // "desktop" = escolheu versão completa
export type PdvRedirectMode = "invite" | "auto" | "off";

/** Padrão 'off' enquanto não houver tela pronta (decisão do Matthews). */
export function parsePdvRedirectMode(v: unknown): PdvRedirectMode {
  const s = typeof v === "string" ? v.replace(/"/g, "") : v;
  return s === "auto" || s === "invite" ? s : "off";
}

export function shouldAutoOpenMobilePdv(env: { width: number; coarse: boolean; pref: string | null }, mode: PdvRedirectMode): boolean {
  return mode === "auto" && env.pref !== "desktop" && isMobileDevice(env);
}

export function shouldShowPdvInvite(env: { width: number; coarse: boolean }, mode: PdvRedirectMode, dismissedAt: number | null, now = Date.now()): boolean {
  if (mode !== "invite" || !isMobileDevice(env)) return false;
  return !dismissedAt || now - dismissedAt >= PDV_INVITE_DISMISS_MS;
}

const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};
export function readPdvPref() { return ls.get(PDV_VIEW_PREF_KEY); }
export function setPdvDesktopPreference(desktop: boolean) { ls.set(PDV_VIEW_PREF_KEY, desktop ? "desktop" : null); }
export function readPdvInviteDismissed(): number | null { const v = Number(ls.get(PDV_INVITE_DISMISS_KEY)); return v > 0 ? v : null; }
export function dismissPdvInvite(now = Date.now()) { ls.set(PDV_INVITE_DISMISS_KEY, String(now)); }
