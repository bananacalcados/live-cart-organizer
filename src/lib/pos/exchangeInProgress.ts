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

type DiffItem = { direcao: string; valor_unitario?: number | null; quantidade?: number | null };
/** Mesma conta do servidor (exchange_create_difference_link): reposição − devolvido. */
export function exchangeDifference(items: DiffItem[]) {
  const sum = (d: string) => items.filter((i) => i.direcao === d).reduce((s, i) => s + Number(i.valor_unitario || 0) * Number(i.quantidade ?? 1), 0);
  const dev = Math.round(sum("devolvido") * 100) / 100;
  const rep = Math.round(sum("reposicao") * 100) / 100;
  return { dev, rep, diff: Math.round((rep - dev) * 100) / 100 };
}
/** Valor do link: só a diferença a pagar (nunca negativa) + frete escolhido. */
export function differenceLinkTotal(diff: number, frete: number, modo: "gratis" | "cotado" | "fixo") {
  const f = modo === "gratis" ? 0 : Math.max(0, frete || 0);
  return Math.round((Math.max(diff, 0) + f) * 100) / 100;
}

const UNPAID = ["online_pending", "pending", "payment_failed", "cancelled"];
/** "Trocar produto": troca aberta, já com produto na Expedição, sem voucher/estorno e diferença não paga (servidor confere envio e nota). */
export function canSwapReplacement(
  e: { tipo: string; status: string; pedido_novo_id: string | null; voucher_id?: string | null; gateway_refund_id?: string | null; diferenca_venda_id?: string | null },
  diffStatus?: string | null,
) {
  if (e.tipo !== "troca" || !OPEN_EXCHANGE_STATUSES.includes(e.status) || !e.pedido_novo_id) return false;
  if (e.voucher_id || e.gateway_refund_id) return false;
  if (e.diferenca_venda_id && diffStatus && !UNPAID.includes(diffStatus)) return false;
  return true;
}

/** "Converter em devolução": mesmas condições de "Cancelar troca", só para tipo troca (servidor confere o resto). */
export function canConvertToReturn(e: { tipo: string; status: string; voucher_id?: string | null; gateway_refund_id?: string | null }) {
  return e.tipo === "troca" && canCancelExchange(e);
}
