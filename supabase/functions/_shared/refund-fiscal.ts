export interface RefundFiscalFacts {
  sale_id: string | null;
  registered: boolean;
  received: boolean;
  return_note_ready: boolean;
  active_sale_note: boolean;
  sale_note_over_24h: boolean;
}

export function refundFiscalDecision(f: RefundFiscalFacts, reason: string, admin = false, override = false, justification = "") {
  const missing: string[] = [];
  if (reason === "devolucao") {
    if (!f.registered) missing.push("registro de devolução");
    if (!f.received) missing.push("produto recebido/conferido");
    if (!f.return_note_ready) missing.push("NF-e de devolução autorizada ou em emissão");
  } else if (reason === "cancelamento_antes_envio" && f.active_sale_note && !(f.registered && f.return_note_ready)) {
    missing.push("cancelar a nota de venda ou registrar a devolução com NF-e");
  }
  const warning = reason === "cancelamento_antes_envio" && f.sale_note_over_24h
    ? "Nota de venda autorizada há mais de 24 horas: o cancelamento pode não ser aceito; regularize pela devolução fiscal." : null;
  const validOverride = admin && override && justification.trim().length >= 3 && justification.trim().length <= 500;
  const error = override && !validOverride ? "Só administrador pode forçar, com justificativa de 3 a 500 caracteres."
    : missing.length && !validOverride ? `Estorno bloqueado. Falta: ${missing.join("; ")}.` : null;
  return { allowed: !error, missing, warning, error, overridden: validOverride && missing.length > 0 };
}

/** Read-only. Never reaches a payment or fiscal provider. */
export async function checkRefundFiscal(sb: any, source: string, id: string, reason: string, admin = false, override = false, justification = "") {
  const { data, error } = await sb.rpc("refund_return_facts", { p_source: source, p_id: id });
  if (error || !data) throw new Error("Não foi possível conferir a devolução e as notas. Estorno não autorizado.");
  return { ...refundFiscalDecision(data, reason, admin, override, justification), facts: data as RefundFiscalFacts };
}