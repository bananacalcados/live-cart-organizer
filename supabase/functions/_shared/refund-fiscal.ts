export interface RefundFiscalFacts {
  sale_id: string | null;
  registered: boolean;
  received: boolean;
  return_note_ready: boolean;
  active_sale_note: boolean;
  sale_note_over_24h: boolean;
  shipped?: boolean;
  sale_note_cancellable?: boolean;
  sale_note_id?: string | null;
  sale_note_modelo?: number | null;
  sale_note_numero?: number | string | null;
}

export type CancelBeforeShipStep = "estorno_direto" | "cancelar_nota" | "nota_entrada_admin" | "aguardar_nota" | "devolucao";

/** Cancelamento antes do envio: qual caminho o pedido segue. */
export function cancelBeforeShipStep(f: RefundFiscalFacts): CancelBeforeShipStep {
  if (f.shipped) return "devolucao";
  if (!f.active_sale_note || (f.registered && f.return_note_ready)) return "estorno_direto";
  if (f.sale_note_cancellable) return "cancelar_nota";
  if (f.sale_note_over_24h) return "nota_entrada_admin";
  return "aguardar_nota";
}

export function refundFiscalDecision(f: RefundFiscalFacts, reason: string, admin = false, override = false, justification = "") {
  const missing: string[] = [];
  if (reason === "devolucao") {
    if (!f.registered) missing.push("registro de devolução");
    if (!f.received) missing.push("produto recebido/conferido");
    if (!f.return_note_ready) missing.push("NF-e de devolução autorizada ou em emissão");
  }
  const step = reason === "cancelamento_antes_envio" ? cancelBeforeShipStep(f) : null;
  if (step === "devolucao") missing.push("o pedido já foi despachado: use o motivo Devolução (registro, recebimento e NF-e de devolução)");
  else if (step === "cancelar_nota") missing.push("cancelar a nota de venda (ainda dá tempo) e depois fazer o estorno");
  else if (step === "nota_entrada_admin") missing.push("a nota não pode mais ser cancelada; é preciso nota de entrada (confirmar com o contador) — estorno só por administrador com motivo");
  else if (step === "aguardar_nota") missing.push("aguardar a nota de venda sair da SEFAZ e então cancelá-la");
  const warning = step === "nota_entrada_admin"
    ? "A nota não pode mais ser cancelada; é preciso nota de entrada (confirmar com o contador). O estorno fica só para administrador, com motivo, e entra na lista de pendências fiscais." : null;
  const validOverride = admin && override && justification.trim().length >= 3 && justification.trim().length <= 500;
  const error = override && !validOverride ? "Só administrador pode forçar, com justificativa de 3 a 500 caracteres."
    : missing.length && !validOverride ? `Estorno bloqueado. Falta: ${missing.join("; ")}.` : null;
  return { allowed: !error, missing, warning, error, overridden: validOverride && missing.length > 0, step };
}

/** Read-only. Never reaches a payment or fiscal provider. */
export async function checkRefundFiscal(sb: any, source: string, id: string, reason: string, admin = false, override = false, justification = "") {
  const { data, error } = await sb.rpc("refund_return_facts", { p_source: source, p_id: id });
  if (error || !data) throw new Error("Não foi possível conferir a devolução e as notas. Estorno não autorizado.");
  return { ...refundFiscalDecision(data, reason, admin, override, justification), facts: data as RefundFiscalFacts };
}