// Regras puras de estorno (Fase 1 — Mercado Pago).
// Espelham as validações da edge function mp-refund para a tela de confirmação
// mostrar os mesmos limites antes de enviar. A validação que vale é a do servidor.

export const MAX_REFUND_AGE_DAYS = 180;

/** Valor ainda estornável de um pagamento. */
export function refundRemaining(transactionAmount: number, refundedSoFar: number): number {
  return Math.max(0, Math.round((transactionAmount - refundedSoFar) * 100) / 100);
}

/** Mercado Pago só permite estorno até 180 dias após a aprovação. */
export function isWithinRefundWindow(dateApproved: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!dateApproved) return true; // sem data não dá pra bloquear no front — o servidor decide
  const approved = new Date(dateApproved);
  return now.getTime() - approved.getTime() <= MAX_REFUND_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Teto de aprovação: admin nunca precisa de aprovação.
 * Sem teto configurado (null), TODO estorno de não-admin aguarda aprovação.
 * Com teto, valores acima dele aguardam aprovação.
 */
export function needsApproval(isAdmin: boolean, approvalThreshold: number | null, amount: number): boolean {
  if (isAdmin) return false;
  if (approvalThreshold == null) return true;
  return amount > approvalThreshold;
}

/** Valida o valor digitado na confirmação. Retorna mensagem de erro ou null. */
export function validateRefundAmount(amount: number, remaining: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Informe um valor de estorno maior que zero.";
  if (amount > remaining + 0.009) return "O valor do estorno é maior que o valor ainda não estornado.";
  return null;
}

/** Confirmação final: o valor digitado precisa ser igual ao valor do estorno. */
export function confirmationAmountMatches(typed: number, amount: number): boolean {
  return Number.isFinite(typed) && Math.abs(typed - amount) < 0.005;
}

/** Lê "R$ 1.359,99", "359,99" ou "359.99" como número. */
export function parseBrlAmount(v: unknown): number {
  let t = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return Number(t);
}
