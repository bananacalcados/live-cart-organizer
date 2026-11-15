import { describe, expect, it } from 'vitest';
import { isUnidentifiedPayout, mpReleaseRecordType } from '../../docs/mp-movement-audit-rules';
describe('auditoria somente leitura de movimentos MP', () => {
  it('não transforma saldo inicial em crédito do mês', () => {
    expect(mpReleaseRecordType({ DATE: '2026-07-01T00:00:00-03:00', DESCRIPTION: '' })).toBe('opening_balance');
  });
  it('não transforma saldo final em movimento', () => {
    expect(mpReleaseRecordType({ DATE: '', DESCRIPTION: '' })).toBe('closing_balance');
  });
  it('reserva de saída não é outra transferência', () => {
    expect(mpReleaseRecordType({ DESCRIPTION: 'reserve_for_payout' })).toBe('reserve');
  });
  it('payout genérico não identifica favorecido', () => {
    expect(isUnidentifiedPayout({ DESCRIPTION: 'payout', NET_DEBIT_AMOUNT: '4.90' })).toBe(true);
  });
  it('favorecido fornecido deixa de ser saída sem identificação', () => {
    expect(isUnidentifiedPayout({ DESCRIPTION: 'payout', NET_DEBIT_AMOUNT: '4.90' }, { beneficiary: 'Exemplo' })).toBe(false);
  });
  it('estorno não entra em transferências sem identificação', () => {
    expect(isUnidentifiedPayout({ DESCRIPTION: 'refund', NET_DEBIT_AMOUNT: '4.90' })).toBe(false);
  });
});