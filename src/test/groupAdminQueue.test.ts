import { describe, it, expect } from 'vitest';
import { classifyActionError, canRetry, supportsGroupAction } from '../../supabase/functions/group-admin-worker/policy';

describe('group administrative queue outcomes', () => {
  it('HTTP 200 GROUP_FORBIDDEN fails without retry or instance failure', () => {
    expect(classifyActionError(200, { code: 'GROUP_FORBIDDEN' }, 'Sem permissão neste grupo')).toEqual({ permanent: true, instanceFailure: false, message: 'Número não é admin do grupo' });
  });
  it('403 and Portuguese permission failures are permanent', () => {
    expect(classifyActionError(403, null, '').instanceFailure).toBe(false);
    expect(classifyActionError(200, null, 'Sem permissão neste grupo').permanent).toBe(true);
  });
  it('allows exactly two retries after the first attempt', () => {
    expect([1, 2, 3].map(canRetry)).toEqual([true, true, false]);
  });
  it('unsupported WaSender actions do not call the provider or pause an instance', () => {
    expect(supportsGroupAction('wasender', 'rename')).toBe(false);
    expect(supportsGroupAction('wasender', 'pin_message')).toBe(false);
    expect(supportsGroupAction('wasender', 'promote_admin')).toBe(true);
    expect(classifyActionError(400, { code: 'UNSUPPORTED_ACTION' }, 'Não suportada').instanceFailure).toBe(false);
  });
});