// Fase 2 — troca em andamento: regras puras usadas pelo cartão do modal do WhatsApp.
export const OPEN_EXCHANGE_STATUSES = ["iniciada", "aguardando_retorno", "recebido_conferencia"];

/** Prazo de postagem vencido: validade da reversa passou e o produto ainda não voltou. */
export function isPostingOverdue(status: string, validUntil: string | null | undefined, today = new Date()): boolean {
  if (!validUntil || !["iniciada", "aguardando_retorno"].includes(status)) return false;
  const iso = today.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return validUntil < iso;
}

export function canAddReplacement(e: { tipo: string; status: string; pedido_novo_id: string | null }) {
  return e.tipo === "troca" && OPEN_EXCHANGE_STATUSES.includes(e.status) && !e.pedido_novo_id;
}

export function canCancelExchange(e: { status: string; voucher_id?: string | null; gateway_refund_id?: string | null }) {
  return OPEN_EXCHANGE_STATUSES.includes(e.status) && !e.voucher_id && !e.gateway_refund_id;
}
