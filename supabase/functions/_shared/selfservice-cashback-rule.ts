export const SELF_SERVICE_CASHBACK_WINDOW_MS = 20 * 60 * 1000;

export function selfserviceCashbackRate(sentAt: string | null, paidAt: string | null): number {
  const sent = sentAt ? Date.parse(sentAt) : NaN;
  const paid = paidAt ? Date.parse(paidAt) : NaN;
  return Number.isFinite(sent) && Number.isFinite(paid) && paid >= sent
    && paid <= sent + SELF_SERVICE_CASHBACK_WINDOW_MS ? 10 : 5;
}

export function selfserviceCashbackAmount(amountPaid: number, rate: number): number {
  return Number.isFinite(amountPaid) && amountPaid > 0 ? Math.round(amountPaid * rate) / 100 : 0;
}