export type AdvertisingChoice = { id: string; accepted: boolean; region: string | null };
export const ADVERTISING_STORAGE_KEY = "bc_selfservice_advertising_v1";
let memory: AdvertisingChoice | null = null;
export function advertisingChoice(): AdvertisingChoice | null {
  try { return JSON.parse(localStorage.getItem(ADVERTISING_STORAGE_KEY) || "null") || memory; } catch { return memory; }
}
export function storeAdvertisingChoice(choice: AdvertisingChoice) {
  memory = choice;
  try { localStorage.setItem(ADVERTISING_STORAGE_KEY, JSON.stringify(choice)); } catch { /* checkout remains available */ }
}

// Regiões que exigem consentimento prévio (EEE, Reino Unido, Suíça). Desconhecida = bloqueia.
const CONSENT_REGIONS = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO","GB","CH"]);
let visitRegion: string | null | undefined;
let regionPromise: Promise<string | null> | null = null;

export function ensureAdvertisingRegion(): Promise<string | null> {
  if (visitRegion !== undefined) return Promise.resolve(visitRegion);
  regionPromise ??= fetch("/cdn-cgi/trace", { signal: AbortSignal.timeout(2000) })
    .then(async (r) => (r.ok ? (await r.text()).match(/^loc=([A-Z]{2})$/m)?.[1] || null : null))
    .catch(() => null)
    .then((loc) => {
      visitRegion = loc && loc !== "XX" && loc !== "T1" ? loc : null;
      window.dispatchEvent(new Event("selfservice-advertising-change"));
      return visitRegion;
    });
  return regionPromise;
}
export function currentAdvertisingRegion() { return visitRegion ?? null; }

/** Rastreamento comum (clique, IP, navegador, valor) sem dados pessoais: fora de região de consentimento e sem recusa. */
export function ordinaryAdvertisingAllowed(): boolean {
  const choice = advertisingChoice();
  if (choice && !choice.accepted) return false;
  return !!visitRegion && !CONSENT_REGIONS.has(visitRegion);
}
export function advertisingRefused(): boolean { const c = advertisingChoice(); return !!c && !c.accepted; }
export function advertisingAllowed(): boolean { return !!advertisingChoice()?.accepted || ordinaryAdvertisingAllowed(); }
