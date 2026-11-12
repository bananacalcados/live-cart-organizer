import type { ConvMessage } from './support-ai.ts';

export type CustomerReceipt = { date: string | null; claimed: boolean; messageAt?: string };

function validDate(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    ? `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}` : null;
}

function spDay(at: string | number) {
  return new Date(new Date(at).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

function shiftDay(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

/** Extração determinística: só mensagens da cliente que afirmam recebimento, depois do envio. */
export function customerReceiptFromConversation(conv: ConvMessage[], shippedAt: string | null, now = Date.now()): CustomerReceipt {
  if (!shippedAt) return { date: null, claimed: false };
  const shippedMs = Date.parse(shippedAt);
  if (!Number.isFinite(shippedMs)) return { date: null, claimed: false };
  let found: CustomerReceipt = { date: null, claimed: false };
  for (const m of conv) {
    if (m.from !== 'cliente' || Date.parse(m.at) < shippedMs) continue;
    const text = (m.text || '').toLowerCase();
    if (!/\b(receb\w*|chegou|entreg\w*)\b/i.test(text) || /\b(n[aã]o\s+(receb\w*|chegou)|ainda\s+n[aã]o)\b/i.test(text)) continue;
    found = { date: null, claimed: true, messageAt: m.at };
    const matches = [...text.matchAll(/\b([0-3]?\d)\s*[\/\\.\-]\s*([01]?\d)\s*[\/\\.\-]\s*(\d{2}|\d{4})\b/g)];
    for (const match of matches) {
      const day = Number(match[1]); const month = Number(match[2]);
      const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
      const date = validDate(year, month, day);
      if (date) found = { date, claimed: true, messageAt: m.at };
    }
    if (!found.date && /\bontem\b/i.test(text)) found = { date: shiftDay(spDay(m.at), -1), claimed: true, messageAt: m.at };
    if (!found.date && /\bhoje\b/i.test(text)) found = { date: spDay(m.at), claimed: true, messageAt: m.at };
  }
  return found;
}
