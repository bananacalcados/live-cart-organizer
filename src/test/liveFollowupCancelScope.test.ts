import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelScope } from '../../supabase/functions/_shared/live-followup-cancel-scope';
import { DEFAULT_FOLLOWUP_CONFIG } from '../../supabase/functions/_shared/live-followup-rules';

vi.mock('../../supabase/functions/_shared/requireAuth.ts', () => ({ internalCallHeaders: async () => ({}) }));
afterEach(() => vi.unstubAllGlobals());

const base = { id: 'initial-job', type: 'B', order_id: 'test-order', sequence_key: 'order:test-order:initial' };
const reminders = [0, 1, 2].map(step => ({ ...base, id: `payment-${step}`, type: 'D', sequence_key: 'order:test-order:D', step }));

describe('escopo do cancelamento do follow-up', () => {
  it.each(['B', 'C'])('cart_already_contacted em %s preserva os três passos D', type => {
    const job = { ...base, type };
    const scope = cancelScope('cart_already_contacted', job);
    expect(scope).toEqual({ column: 'id', value: job.id });
    expect([job, ...reminders].filter(row => row[scope.column] === scope.value).map(row => row.id)).toEqual([job.id]);
  });
  it.each(['paid', 'customer_replied', 'order_closed', 'registration_completed', 'human_attendance'])('%s mantém todos os jobs do pedido', reason => {
    const scope = cancelScope(reason, base);
    expect(scope).toEqual({ column: 'order_id', value: 'test-order' });
    expect([base, ...reminders].filter(row => row[scope.column] === scope.value)).toHaveLength(4);
  });
  it('sem pedido mantém o escopo da sequência', () => {
    expect(cancelScope('customer_replied', { ...base, order_id: null })).toEqual({ column: 'sequence_key', value: base.sequence_key });
  });
  it.each(['A', 'D', 'E', 'F'])('não muda o escopo do tipo %s', type => {
    expect(cancelScope('cart_already_contacted', { ...base, type })).toEqual({ column: 'order_id', value: base.order_id });
  });
});

describe('processGlobalFollowups sem chamadas externas', () => {
  it.each(['B', 'C'])('tipo %s preserva D no contexto e na reserva recusada', async type => {
    // Load the Deno worker at runtime; the browser typecheck must not traverse server imports.
    const workerPath = '../../supabase/functions/_shared/live-followup.ts';
    const { processGlobalFollowups } = await import(/* @vite-ignore */ workerPath);
    for (const alreadySent of [true, false]) {
      const rows = [base, ...reminders].map(row => ({ ...row, type: row.id === base.id ? type : row.type,
        customer_key: 'wa:test', event_id: 'test-event', status: row.id === base.id ? 'processing' : 'pending',
        whatsapp_number_id: 'test-instance', channel: 'whatsapp', step: 0, variant: 0, scheduled_at: new Date().toISOString() }));
      const context = { global_enabled: true, type_enabled: true,
        event: { live_followup_enabled: true, whatsapp_number_id: 'test-instance', self_service_slug: 'test' },
        order: { id: base.order_id, products: [{}], stage: 'awaiting_confirmation', selfservice_cart_sent_at: alreadySent ? new Date().toISOString() : null },
        number: { provider: 'wasender', is_active: true, is_online: true } };
      let reserveCalls = 0;
      const fetchMock = vi.fn(() => { throw new Error('External calls forbidden'); });
      vi.stubGlobal('fetch', fetchMock);
      vi.stubGlobal('Deno', { env: { get: () => undefined } });
      const sb = {
        rpc: async (name: string) => {
          if (name === 'live_followup_claim') return { data: [rows[0]], error: null };
          if (name === 'live_followup_job_context') return { data: context, error: null };
          if (name === 'live_followup_postpone') return { data: { action: 'send' }, error: null };
          if (name === 'live_followup_cart_reserve') { reserveCalls++; return { data: false, error: null }; }
          throw new Error(`Unexpected RPC: ${name}`);
        },
        from: (table: string) => {
          if (table === 'live_followup_settings') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: DEFAULT_FOLLOWUP_CONFIG }, error: null }) }) }) };
          if (table !== 'live_followup_jobs') throw new Error(`Unexpected table: ${table}`);
          return { update: (values: Record<string, unknown>) => {
            const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
            const apply = () => { rows.filter(row => predicates.every(predicate => predicate(row))).forEach(row => Object.assign(row, values)); return { data: { id: base.id }, error: null }; };
            const query = {
              eq: (column: string, value: unknown) => { predicates.push(row => row[column] === value); return query; },
              in: (column: string, values: unknown[]) => { predicates.push(row => values.includes(row[column])); return query; },
              select: () => query, maybeSingle: async () => apply(),
              then: (resolve: (value: unknown) => unknown) => Promise.resolve(apply()).then(resolve),
            };
            return query;
          } };
        },
      };
      expect(await processGlobalFollowups(sb)).toEqual({ processed: 1, sent: 0 });
      expect(rows[0].status).toBe('cancelled');
      expect(rows.slice(1).map(row => row.status)).toEqual(['pending', 'pending', 'pending']);
      expect(reserveCalls).toBe(alreadySent ? 0 : 1);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });
});