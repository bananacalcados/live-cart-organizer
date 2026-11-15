export function mpReleaseRecordType(row: { DATE?: string; DESCRIPTION?: string }) {
  if (!row.DESCRIPTION) return row.DATE ? 'opening_balance' : 'closing_balance';
  return row.DESCRIPTION.startsWith('reserve_') ? 'reserve' : 'movement';
}
export function isUnidentifiedPayout(row: { DESCRIPTION?: string; NET_DEBIT_AMOUNT?: string }, detail: { beneficiary?: string; entered_description?: string } = {}) {
  return row.DESCRIPTION === 'payout' && Number(row.NET_DEBIT_AMOUNT) > 0 && !detail.beneficiary && !detail.entered_description;
}