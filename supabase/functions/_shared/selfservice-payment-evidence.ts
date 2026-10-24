export function capturedAustpayEvidence(tx: any, transactionId: string, linkedOrderId: string, orderId: string) {
  const id = String(tx.id || tx.transaction_id || "");
  if (tx.status !== "APPROVED" || id !== transactionId || linkedOrderId !== orderId) throw new Error("AustPay sem captura vinculada ao pedido");
  // GET may omit external_reference; an explicit conflicting reference is never accepted.
  if (tx.external_reference != null && tx.external_reference !== orderId) throw new Error("Referência AustPay divergente");
  const amount = Number(tx.approved_amount ?? tx.amount) / 100;
  const paidAt = tx.approved_at || tx.paid_at || tx.captured_at;
  if (!(amount > 0) || !paidAt || !Number.isFinite(Date.parse(paidAt))) throw new Error("AustPay sem valor e horário de captura");
  return { amount, paidAt };
}