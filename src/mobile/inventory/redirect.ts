export const MOBILE_PREF_KEY = "inventory_view_pref"; // "desktop" = usuária escolheu versão completa

export function shouldUseMobileInventory(env: { width: number; coarse: boolean; pref: string | null }): boolean {
  if (env.pref === "desktop") return false;
  return env.coarse && env.width < 768;
}

export function readEnv() {
  let pref: string | null = null;
  try { pref = localStorage.getItem(MOBILE_PREF_KEY); } catch { /* ignore */ }
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return { width: window.innerWidth, coarse, pref };
}

export function setDesktopPreference(desktop: boolean) {
  try { desktop ? localStorage.setItem(MOBILE_PREF_KEY, "desktop") : localStorage.removeItem(MOBILE_PREF_KEY); } catch { /* ignore */ }
}
