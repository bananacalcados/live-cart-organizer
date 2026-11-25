import type { DbCustomer } from '@/types/database';

/** Display-only hint. Never use this to prove identity or merge customers. */
export function savedLivePhoneLast4(customer?: Pick<DbCustomer, 'phone_last4' | 'phone_last4_updated_at' | 'whatsapp'> | null, orderLast4?: string | null): string {
  if (orderLast4 && /^\d{4}$/.test(orderLast4)) return orderLast4;
  if (customer?.phone_last4_updated_at) return customer.phone_last4 || '';
  const digits = (customer?.whatsapp || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}