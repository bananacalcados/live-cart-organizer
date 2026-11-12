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
// Upper bound: UTF-8 input bytes plus schema framing, and the model's full 128k output window.
// No existing model output cap is changed. Each tool continuation reserves separately.
export function requestTokenReservation(body: string): number {
  return new TextEncoder().encode(body).length + 4096 + 128000;
}