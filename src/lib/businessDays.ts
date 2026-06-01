// Shared business-day helpers for POS goal pacing.
// Regra acordada: dia útil = segunda a sábado, EXCLUINDO domingos e feriados
// nacionais (fixos + móveis). Ex.: Junho/2026 = 25 dias úteis (tira 4 domingos
// + Corpus Christi 04/06).

/** Parse a "yyyy-MM-dd" string as a LOCAL date (avoids UTC off-by-one shift). */
export function parseLocalDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const [y, m, d] = value.split("T")[0].split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}

function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Brazilian national holidays (fixed + Easter-based mobile) for a given year. */
export function getBrazilianHolidays(year: number): Set<string> {
  const fixed = [
    `${year}-01-01`, // Confraternização Universal
    `${year}-04-21`, // Tiradentes
    `${year}-05-01`, // Dia do Trabalho
    `${year}-09-07`, // Independência
    `${year}-10-12`, // Nossa Senhora Aparecida
    `${year}-11-02`, // Finados
    `${year}-11-15`, // Proclamação da República
    `${year}-12-25`, // Natal
  ];

  const easter = getEasterDate(year);
  const carnaval = addDays(easter, -47); // Terça de Carnaval
  const carnavalSeg = addDays(easter, -48); // Segunda de Carnaval
  const sextaSanta = addDays(easter, -2); // Sexta-feira Santa
  const corpusChristi = addDays(easter, 60); // Corpus Christi

  const mobile = [carnaval, carnavalSeg, sextaSanta, corpusChristi].map((d) => formatDateKey(d));

  return new Set([...fixed, ...mobile]);
}

/** Count business days (Mon-Sat, excluding holidays) between two dates (inclusive). */
export function countBusinessDays(start: Date, end: Date, holidays: Set<string>): number {
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);
  while (cur <= endDate) {
    const dow = cur.getDay(); // 0 = domingo
    if (dow !== 0 && !holidays.has(formatDateKey(cur))) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
