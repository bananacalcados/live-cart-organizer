// Pure guards shared by the live queue, gateway budget and tests.
export const DAILY_TOKEN_BUDGET = 2_000_000;
export const SILENCE_MS = 120_000;
export const RECENT_ORDER_MS = 60 * 86_400_000;
export const HUMAN_PAUSE_MS = 2 * 3_600_000;
export function supportKeywords(text: string): boolean {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(troca\w*|devolver|devolucao|reembolso\w*|estorno\w*|rastreio|rastrear|cade|entrega\w*|defeito\w*|cancelar|codigo|postagem|numeracao)\b|nao chegou|ficou (pequeno|grande)|nao (me )?serviu/.test(t);
}
export function costPrefilter(input: { text: string; group?: boolean; mediaType?: string | null; lastOrderAt?: string | null; lastHumanAt?: string | null; lastIncomingAt?: string; now: number }): string | null {
  if (input.group) return "grupo";
  if (/^(sticker|reaction|reacao|figurinha)$/i.test(input.mediaType ?? "") || !/[\p{L}\p{N}]/u.test(input.text)) return "sem_texto";
  if (input.lastHumanAt && input.now - Date.parse(input.lastHumanAt) <= HUMAN_PAUSE_MS) return "humano_2h";
  if (input.lastIncomingAt && input.now - Date.parse(input.lastIncomingAt) < SILENCE_MS) return "aguardando_silencio";
  if (supportKeywords(input.text) || (input.lastOrderAt && Date.parse(input.lastOrderAt) >= input.now - RECENT_ORDER_MS)) return null;
  return "sem_pedido_ou_palavra";
}
export function budgetAllows(used: number, reserved: number, requested: number, budget = DAILY_TOKEN_BUDGET): boolean {
  return requested > 0 && used + reserved + requested <= budget;
}
// Reserva proporcional: tokens de entrada estimados com folga (~3 bytes/token; texto PT costuma dar ~4)
// + limite de saída esperado com margem. O acerto (settle) cobra o uso real; sem usage cobra a reserva.
export const OUTPUT_RESERVATION_TOKENS = 16_000;
export function requestTokenReservation(body: string): number {
  return Math.ceil(new TextEncoder().encode(body).length / 3) + 1024 + OUTPUT_RESERVATION_TOKENS;
}
/** Motivo legível da recusa da reserva, gravado em support_ai_attempts. */
export function reserveRefusalReason(r: { reason?: string; used?: number; reserved?: number; budget?: number } | null, rpcError?: string | null): string {
  if (r?.reason === "teto_diario" || r?.reason === "teto_diario_tokens") {
    return `teto_diario: usado ${r.used ?? "?"} (+${r.reserved ?? 0} reservado) de ${r.budget ?? "?"}`;
  }
  return String(r?.reason ?? rpcError ?? "indisponivel");
}
/** Faixa de alerta do consumo diário (80% e 100%). */
export function budgetAlertLevel(used: number, budget: number): 80 | 100 | null {
  if (!(budget > 0)) return null;
  if (used >= budget) return 100;
  if (used >= budget * 0.8) return 80;
  return null;
}
