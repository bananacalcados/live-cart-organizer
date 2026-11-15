import { describe, expect, it } from 'vitest';
import { includeMpRefund } from '../../docs/gateway-audit-rules';
describe('Mercado Pago audit scope', () => {
  it('includes fully refunded paid payments', () => expect(includeMpRefund({status:'refunded'})).toBe(true));
  it('includes chargebacks separately from cancellation', () => expect(includeMpRefund({status:'charged_back'})).toBe(true));
  it('includes an approved partial refund', () => expect(includeMpRefund({status:'approved',transaction_amount_refunded:10})).toBe(true));
  it('excludes approved payments without a refund', () => expect(includeMpRefund({status:'approved',transaction_amount_refunded:0})).toBe(false));
  it('excludes cancelled unpaid Pix even if other fields look refunded', () => expect(includeMpRefund({status:'cancelled',transaction_amount_refunded:10})).toBe(false));
  it('excludes rejected payments', () => expect(includeMpRefund({status:'rejected'})).toBe(false));
});