// Audit inclusion is independent of checkout state: never count unpaid cancellations.
export function includeMpRefund(p: { status: string; transaction_amount_refunded?: number }) {
  return p.status === 'refunded' || p.status === 'charged_back' ||
    (p.status === 'approved' && Number(p.transaction_amount_refunded) > 0);
}