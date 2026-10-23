/** External receipts describe the purchase customer separately from bank evidence. */
export function externalRefundEvidence(row: {
  amount: unknown;
  mp_response?: { external_import?: Record<string, unknown> } | null;
}) {
  const evidence = row.mp_response?.external_import;
  if (!evidence || evidence.payment_status !== "refunded") return null;
  const paid = Number(evidence.payment_amount);
  if (!Number.isFinite(paid) || paid <= 0 || Number(row.amount) > paid) return null;
  return {
    paidAmount: paid,
    recipientName: String(evidence.recipient_name || "Não informado"),
    recipientCpfMasked: String(evidence.recipient_cpf_masked || "Não informado"),
    displayedDate: String(evidence.displayed_datetime || "Não informado"),
  };
}