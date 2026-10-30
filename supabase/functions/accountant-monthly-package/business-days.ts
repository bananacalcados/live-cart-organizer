// Regras de dia útil (segunda a sexta, sem feriados nacionais), em São Paulo.

/** Data civil AAAA-MM-DD em São Paulo (UTC-3). */
export function spToday(now: Date = new Date()): string {
  return new Date(now.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Posição do dia como dia útil no mês (1 = 1º dia útil); null se não for dia útil. */
export function businessDayIndex(day: string, holidays: Set<string>): number | null {
  const [y, m, d] = day.split("-").map(Number);
  const isBiz = (dd: number) => {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
    return wd !== 0 && wd !== 6 && !holidays.has(iso);
  };
  if (!isBiz(d)) return null;
  let n = 0;
  for (let i = 1; i <= d; i++) if (isBiz(i)) n++;
  return n;
}

/** Mês anterior em AAAA-MM. */
export function previousMonth(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
