import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOLLOWUP_CONFIG } from '../../supabase/functions/_shared/live-followup-rules';
vi.mock('../../supabase/functions/_shared/requireAuth.ts', () => ({ internalCallHeaders: async () => ({}) }));

const now = new Date().toISOString();
const cutover = new Date(Date.now() - 60_000).toISOString();
function source(origin: string | null = 'catalog') {
  return { source_key: 'orders:test-catalog-order', changed_at: now, context: {
    event: { id: 'event', live_followup_enabled: true, whatsapp_number_id: 'number' },
    order: { id: 'test-catalog-order', created_at: now, registered_at: now, origin, attribution: {}, is_paid: false, paid_externally: false, stage: 'awaiting_payment', products: [{}], selfservice_cart_sent_at: now },
    access: null, registration: { whatsapp: '63984053995' }, customer: {}, cart_sent_at: now,
    first_item_at: now, paid_same_day: true, cart_followup_cutover_at: cutover,
  } };
}
async function run(sources: ReturnType<typeof source>[], repeat = 1, simulation = false) {
  const path = process.env.FOLLOWUP_SCHEDULER_BEFORE === '1' ? '../../docs/followups/rollback/20261128-scheduler-before-manual-catalog.ts' : '../../supabase/functions/_shared/live-followup.ts';
  const { scheduleGlobalFollowups } = await import(/* @vite-ignore */ path);
  const rows = new Map<string, any>();
  const acks: string[] = [];
  const sb = {
    rpc: async (name: string) => {
      if (!['live_followup_source_contexts', 'live_followup_audit_contexts'].includes(name)) throw new Error(`Unexpected RPC ${name}`);
      return { data: sources, error: null };
    },
    from: (table: string) => {
      if (table === 'live_followup_settings') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: { ...DEFAULT_FOLLOWUP_CONFIG, enabled: true, enabled_since: '2026-11-09T18:39:54.937Z' } }, error: null }) }) }) };
      if (table === 'live_followup_jobs') return { upsert: async (jobs: any[], options: any) => {
        expect(options).toEqual({ onConflict: 'customer_key,sequence_key,step', ignoreDuplicates: true });
        jobs.forEach(row => { const key = `${row.customer_key}|${row.sequence_key}|${row.step}`; if (!rows.has(key)) rows.set(key, row); });
        return { error: null };
      }, update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) };
      if (table === 'live_followup_sources') return { delete: () => ({ eq: (_field: string, key: string) => ({ eq: async () => { acks.push(key); return { error: null }; } }) }) };
      throw new Error(`Unexpected table ${table}`);
    },
  };
  let result: any;
  for (let i = 0; i < repeat; i++) result = await scheduleGlobalFollowups(sb, simulation ? { eventId: 'event', offset: 0 } : undefined);
  return { rows: [...rows.values()], acks, result };
}

describe('Carrinho não pago do cross-sell recebe D após envio do link', () => {
  it.each(['catalog', null])('origin %s sem acesso: D10/25/45 precede E3h', async origin => {
    const { rows } = await run([source(origin)]);
    expect(rows.map(row => [row.type, row.step])).toEqual([['D', 0], ['D', 1], ['D', 2]]);
    rows.forEach((row, step) => {
      const minutes = (Date.parse(row.scheduled_at) - Date.parse(row.base_at)) / 60_000;
      expect(minutes).toBeGreaterThanOrEqual([10, 25, 45][step] - 1);
      expect(minutes).toBeLessThanOrEqual([10, 25, 45][step] + 1);
    });
  });
  it('E não foi removido: continua para catálogo sem link de carrinho enviado', async () => {
    const row = source();
    row.context.order.selfservice_cart_sent_at = null as unknown as string;
    row.context.cart_sent_at = null as unknown as string;
    expect((await run([row])).rows.map(job => [job.type, job.step])).toEqual([['E', 0], ['E', 1], ['E', 2]]);
  });
  it('origem antiga/catalog/online não permite novo D de carrinho anterior ao corte', async () => {
    const row = source();
    row.context.order.selfservice_cart_sent_at = new Date(Date.now() - 20 * 60_000).toISOString();
    row.context.cart_sent_at = row.context.order.selfservice_cart_sent_at;
    const result = await run([row]);
    expect(result.rows).toHaveLength(0);
    expect(result.acks).toHaveLength(1);
  });
  it('deploy da guarda antes do SQL mantém a fonte: não envia nem ACK sem corte', async () => {
    const row = source();
    delete (row.context as Partial<typeof row.context>).cart_followup_cutover_at;
    const result = await run([row]);
    expect(result.rows).toHaveLength(0);
    expect(result.acks).toHaveLength(0);
    expect(result.result.deferred).toBe(1);
  });
  it('auditoria simulada continua contando D sem gravar jobs nem chamar provedor', async () => {
    const row = source();
    delete (row.context as Partial<typeof row.context>).cart_followup_cutover_at;
    const result = await run([row], 1, true);
    expect(result.result.counts.D).toBe(3);
    expect(result.result.provider_calls).toBe(0);
    expect(result.rows).toHaveLength(0);
    expect(result.acks).toHaveLength(0);
  });
  it.each(['paid', 'cancelled', 'shipped', 'refunded'])('pedido %s não cria D nem E', async stage => {
    const row = source();
    row.context.order.stage = stage;
    expect((await run([row])).rows).toHaveLength(0);
  });
  it('pago externamente não cria cobrança', async () => {
    const row = source(); row.context.order.paid_externally = true;
    expect((await run([row])).rows).toHaveLength(0);
  });
  it('mesclado não cria cobrança', async () => {
    const row = source(); Object.assign(row.context.order, { merged_into_order_id: 'another-order' });
    expect((await run([row])).rows).toHaveLength(0);
  });
  it('duas execuções e o mesmo cliente em dois pedidos não duplicam etapa por pedido', async () => {
    const first = source(null); const second = source('catalog');
    second.source_key = 'orders:second-order'; second.context.order.id = 'second-order';
    const { rows } = await run([first, second], 2);
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map(row => `${row.sequence_key}:${row.step}`)).size).toBe(6);
    expect(rows.filter(row => row.order_id === 'second-order')).toHaveLength(3);
  });
});