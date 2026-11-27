/** Contagem guardada no aparelho: total acumulado por variação + último total que o servidor confirmou. */
export interface ScanEntry { qty: number; sent: number; since: string; name: string; color: string | null; size: string | null }
export interface ScanState { entries: Record<string, ScanEntry>; history: string[]; unknown: Record<string, number> }

export const emptyScan = (): ScanState => ({ entries: {}, history: [], unknown: {} });

export function addScan(s: ScanState, variantId: string, info: Omit<ScanEntry, "qty" | "sent" | "since">, now = new Date().toISOString()): ScanState {
  const cur = s.entries[variantId];
  const entry: ScanEntry = cur ? { ...cur, qty: cur.qty + 1, since: cur.qty === cur.sent ? now : cur.since } : { ...info, qty: 1, sent: 0, since: now };
  return { ...s, entries: { ...s.entries, [variantId]: entry }, history: [...s.history, variantId].slice(-500) };
}

export function undoLast(s: ScanState): ScanState {
  const id = s.history[s.history.length - 1];
  if (!id || !s.entries[id]) return s;
  const e = s.entries[id];
  return { ...s, entries: { ...s.entries, [id]: { ...e, qty: Math.max(0, e.qty - 1) } }, history: s.history.slice(0, -1) };
}

export function setQty(s: ScanState, variantId: string, qty: number, now = new Date().toISOString()): ScanState {
  const e = s.entries[variantId];
  if (!e || !Number.isInteger(qty) || qty < 0) return s;
  return { ...s, entries: { ...s.entries, [variantId]: { ...e, qty, since: e.qty === e.sent ? now : e.since } } };
}

export function addUnknown(s: ScanState, code: string): ScanState {
  return { ...s, unknown: { ...s.unknown, [code]: (s.unknown[code] || 0) + 1 } };
}

/** Só o que mudou desde o último envio confirmado (até 200 por envio). */
export function pendingItems(s: ScanState) {
  return Object.entries(s.entries).filter(([, e]) => e.qty !== e.sent)
    .slice(0, 200).map(([variant_id, e]) => ({ variant_id, qty: e.qty, since: e.since }));
}
export const pendingCount = (s: ScanState) => Object.values(s.entries).filter((e) => e.qty !== e.sent).length;

export function markSent(s: ScanState, sent: { variant_id: string; qty: number }[]): ScanState {
  const entries = { ...s.entries };
  for (const it of sent) if (entries[it.variant_id]) entries[it.variant_id] = { ...entries[it.variant_id], sent: it.qty };
  return { ...s, entries };
}

export const totalPairs = (s: ScanState) => Object.values(s.entries).reduce((a, e) => a + e.qty, 0);

const key = (cycleId: string) => `m-scan-${cycleId}`;
export function loadScan(cycleId: string): ScanState {
  try { const raw = localStorage.getItem(key(cycleId)); if (raw) return { ...emptyScan(), ...JSON.parse(raw) }; } catch { /* ignore */ }
  return emptyScan();
}
export function saveScan(cycleId: string, s: ScanState) { try { localStorage.setItem(key(cycleId), JSON.stringify(s)); } catch { /* ignore */ } }

export function deviceId(): string {
  try {
    let id = localStorage.getItem("m-device-id");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("m-device-id", id); }
    return id;
  } catch { return "sem-armazenamento"; }
}

/** Confirmação: precisa digitar exatamente o número de pares que serão zerados. */
export const confirmMatches = (typed: string, pairs: number) => typed.trim() !== "" && Number(typed.trim()) === Math.round(pairs);
