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