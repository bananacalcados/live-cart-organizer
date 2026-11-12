export type SupportWaitLevel = "normal" | "1h" | "4h" | "24h";

export interface SupportWaitInfo {
  waiting: boolean;
  level: SupportWaitLevel;
  waitingSince: string | null;
}

const HOUR = 60 * 60 * 1000;

/** A espera compara a última entrada com a última saída, sem depender de "lida". */
export function supportWaitInfo(
  lastIncomingAt?: string | null,
  lastOutgoingAt?: string | null,
  now = Date.now(),
): SupportWaitInfo {
  if (!lastIncomingAt) return { waiting: false, level: "normal", waitingSince: null };
  const incoming = new Date(lastIncomingAt).getTime();
  const outgoing = lastOutgoingAt ? new Date(lastOutgoingAt).getTime() : 0;
  if (!Number.isFinite(incoming) || incoming <= outgoing) {
    return { waiting: false, level: "normal", waitingSince: null };
  }
  const elapsed = Math.max(0, now - incoming);
  const level: SupportWaitLevel = elapsed > 24 * HOUR ? "24h" : elapsed > 4 * HOUR ? "4h" : elapsed > HOUR ? "1h" : "normal";
  return { waiting: true, level, waitingSince: lastIncomingAt };
}

export interface SupportSortRow {
  waiting: boolean;
  last_incoming_at: string | null;
  last_message_at: string | null;
}

/** Quem espera vem primeiro, do mais antigo ao mais recente; demais, mais recentes primeiro. */
export function compareSupportRows(a: SupportSortRow, b: SupportSortRow): number {
  if (a.waiting !== b.waiting) return a.waiting ? -1 : 1;
  if (a.waiting) {
    return new Date(a.last_incoming_at || 0).getTime() - new Date(b.last_incoming_at || 0).getTime();
  }
  return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime();
}

export function formatSupportAge(from?: string | null, now = Date.now()): string {
  if (!from) return "sem horário";
  const minutes = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000));
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 1440) return `há ${Math.floor(minutes / 60)}h ${minutes % 60}min`;
  return `há ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

export const EXCHANGE_DESK_TAB_ORDER = [
  "suporte",
  "precisa",
  "andamento",
  "concluidas",
  "sugestoes",
  "treino",
  "assistente",
  "roteiro",
  "custo",
] as const;

export type ExchangeDeskTab = (typeof EXCHANGE_DESK_TAB_ORDER)[number];

export function exchangeDeskTabs(isAdmin: boolean): ExchangeDeskTab[] {
  return EXCHANGE_DESK_TAB_ORDER.filter((tab) => isAdmin || !["treino", "roteiro", "custo"].includes(tab));
}

export function resolveExchangeDeskTab(raw: string | null | undefined, isAdmin: boolean): ExchangeDeskTab {
  const tabs = exchangeDeskTabs(isAdmin);
  return tabs.includes(raw as ExchangeDeskTab) ? (raw as ExchangeDeskTab) : "suporte";
}
