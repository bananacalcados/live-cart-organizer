import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOLLOWUP_CONFIG } from '../../supabase/functions/_shared/live-followup-rules';

vi.mock('../../supabase/functions/_shared/requireAuth.ts', () => ({ internalCallHeaders: async () => ({}) }));
const prepared = 'docs/followups/prepared/';
const eventId = '6fec3683-c888-449a-b3da-a0a37ad588df';
const customerId = 'd4e0919c-bb23-460f-8f16-a43a37421000';
const paidId = '669ad532-ecf2-48c9-9da2-e6682fd724a2';
const openId = '001e06c5-a0b8-4323-9a2c-27e760729613';
const staffId = '1db05656-0000-4000-8000-000000000001';
type Source = { source_key: string; changed_at: string; context: Record<string, any> };
let results: { before_sources: number; orders_persisted: number; access_sources: number; old: Source[]; fresh: Source[]; jobs_before: unknown[]; jobs_after: unknown[] };

beforeAll(() => {
  const original = readFileSync(prepared + 'live_followup_dirty-production-20261128.sql', 'utf8');
  const contexts = readFileSync(prepared + 'live_followup_source_contexts-production-20261128.sql', 'utf8');
  const correction = process.env.FOLLOWUP_REPRO_BEFORE === '1' ? '' : readFileSync(prepared + 'MANUAL-CART-FIX.sql', 'utf8');
  const fixture = `${readFileSync('src/test/fixtures/liveFollowupManualCart.sql', 'utf8')}
    ${original}\n${contexts}
    CREATE TRIGGER live_followup_order_insert AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION live_followup_dirty();
    CREATE TRIGGER live_followup_order_update AFTER UPDATE ON orders FOR EACH ROW WHEN (OLD.live_followup_cart_sent_at IS DISTINCT FROM NEW.live_followup_cart_sent_at OR OLD.stage IS DISTINCT FROM NEW.stage) EXECUTE FUNCTION live_followup_dirty();
    CREATE TRIGGER access_dirty AFTER INSERT ON live_selfservice_accesses FOR EACH ROW EXECUTE FUNCTION live_followup_dirty();
    INSERT INTO events VALUES('${eventId}','Live fixture',true,NULL,'0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c','live');
    INSERT INTO customers VALUES('${customerId}','5563984053995','Cliente fixture','joanadarcs.p');
    INSERT INTO orders(id,event_id,customer_id,created_at,origin,is_paid,paid_externally,stage,products,live_followup_cart_sent_at) VALUES
      ('${paidId}','${eventId}','${customerId}','2026-11-28 16:07:59+00',NULL,true,false,'paid','[{},{}]','2026-11-28 16:15:55.996+00'),
      ('${openId}','${eventId}','${customerId}','2026-11-28 16:35:57+00',NULL,false,false,'awaiting_confirmation','[{}]','2026-11-28 16:38:17.935+00'),
      ('${staffId}','${eventId}','${customerId}','2026-11-28 16:35:57+00',NULL,false,false,'awaiting_confirmation','[{}]','2026-11-28 16:39:00+00');
    INSERT INTO customer_registrations SELECT gen_random_uuid(),id,'63984053995','Cliente fixture' FROM orders;
    CREATE TEMP TABLE evidence(value jsonb);
    INSERT INTO evidence SELECT jsonb_build_object('before_sources',(SELECT count(*) FROM live_followup_sources),'orders_persisted',(SELECT count(*) FROM orders));
    INSERT INTO live_selfservice_accesses(id,event_id,order_ids,created_at) VALUES(gen_random_uuid(),'${eventId}',ARRAY['${openId}'::uuid],now());
    UPDATE evidence SET value=value||jsonb_build_object('access_sources',(SELECT count(*) FROM live_followup_sources));
    TRUNCATE live_selfservice_accesses,live_followup_sources;
    INSERT INTO live_followup_jobs VALUES
      ('00000000-0000-4000-8000-000000000001','sent','2026-11-28 16:25:00+00','2026-11-28 16:25:01+00',NULL),
      ('00000000-0000-4000-8000-000000000002','cancelled','2026-11-28 16:25:00+00',NULL,'paid'),
      ('00000000-0000-4000-8000-000000000003','pending','2026-11-28 18:25:00+00',NULL,NULL);
    UPDATE evidence SET value=value||jsonb_build_object('jobs_before',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM live_followup_jobs j));
    SET app.followup_manual_apply_authorized='yes';
    SET app.followup_manual_scheduler_guard_reviewed='yes';
    ${correction}
    UPDATE evidence SET value=value||jsonb_build_object('jobs_after',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM live_followup_jobs j));
    UPDATE orders SET stage='awaiting_payment' WHERE NOT is_paid;
    UPDATE evidence SET value=value||jsonb_build_object('old',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM live_followup_source_contexts(50) s));
    TRUNCATE live_followup_sources;
    UPDATE orders SET live_followup_cart_sent_at=clock_timestamp() WHERE NOT is_paid;
    UPDATE evidence SET value=value||jsonb_build_object('fresh',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM live_followup_source_contexts(50) s));
    SELECT 'MANUAL_JSON:'||value::text FROM evidence;`;
  const output = execFileSync('bash', ['src/test/runEventShippingIsolated.sh'], { input: fixture, encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] });
  const line = output.split('\n').find(row => row.startsWith('MANUAL_JSON:'));
  if (!line) throw new Error('Isolated PostgreSQL returned no evidence');
  results = JSON.parse(line.slice('MANUAL_JSON:'.length));
}, 120_000);

async function schedule(sources: Source[], baseline = false) {
  const path = baseline ? '../../docs/followups/rollback/20261128-scheduler-before-manual-catalog.ts' : '../../docs/followups/prepared/manual-cart-scheduler.ts';
  const { scheduleGlobalFollowups } = await import(/* @vite-ignore */ path);
  const jobs: any[] = [];
  const acks: string[] = [];
  const sb = {
    rpc: async (name: string) => {
      if (name !== 'live_followup_source_contexts') throw new Error(`Unexpected RPC ${name}`);
      return { data: sources, error: null };
    },
    from: (table: string) => {
      if (table === 'live_followup_settings') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: { ...DEFAULT_FOLLOWUP_CONFIG, enabled: true, enabled_since: '2026-11-09T18:39:54.937Z' } }, error: null }) }) }) };
      if (table === 'live_followup_jobs') return { upsert: async (rows: any[]) => { jobs.push(...rows); return { error: null }; }, update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) };
      if (table === 'live_followup_sources') return { delete: () => ({ eq: (_field: string, key: string) => ({ eq: async () => { acks.push(key); return { error: null }; } }) }) };
      throw new Error(`Unexpected table ${table}`);
    },
  };
  await scheduleGlobalFollowups(sb);
  return { jobs, acks };
}

describe('Carrinho manual — defeito implantado e correção NÃO aplicada', () => {
  it('reproduz a perda antes do agendador: três pedidos ficam salvos, zero fontes', () => {
    expect(results.orders_persisted).toBe(3);
    expect(results.before_sources).toBe(0);
  });
  it('explica por que o acesso online mascara o defeito: cria fonte do acesso e do pedido', () => {
    expect(results.access_sources).toBe(2);
  });
  it('pedido recorrente aberto sem access agenda os três D, independentemente do primeiro pago', async () => {
    const sources = results.fresh.filter(row => row.context.order?.id === openId);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.context.access).toBeNull();
    const { jobs } = await schedule(sources);
    expect(jobs.map(row => row.step)).toEqual([0, 1, 2]);
    expect(jobs.every(row => row.type === 'D' && row.sequence_key === `order:${openId}:D` && row.customer_key === 'wa:6384053995')).toBe(true);
    expect(jobs[0]?.phone).toBe('5563984053995');
  });
  it('pedido criado pela atendente usa carimbo manual e remetente exato da live', async () => {
    const { jobs } = await schedule(results.fresh.filter(row => row.context.order?.id === staffId));
    expect(jobs).toHaveLength(3);
    expect(jobs.every(row => row.whatsapp_number_id === '0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c' && row.access_id === null)).toBe(true);
    jobs.forEach((row, step) => {
      const minutes = (Date.parse(row.scheduled_at) - Date.parse(row.base_at)) / 60_000;
      expect(minutes).toBeGreaterThanOrEqual([10, 25, 45][step] - 1);
      expect(minutes).toBeLessThanOrEqual([10, 25, 45][step] + 1);
    });
  });
  it('a aplicação não reprocessa nem altera jobs enviados, cancelados ou pendentes', () => {
    expect(results.jobs_before).toHaveLength(3);
    expect(results.jobs_after).toEqual(results.jobs_before);
  });
  it('carrinhos manuais anteriores ao corte NÃO são recuperados por mudança de etapa', async () => {
    expect(results.old).toHaveLength(2);
    expect(results.old.every(row => row.context.manual_cart_before_cutover === true)).toBe(true);
    const { jobs, acks } = await schedule(results.old);
    expect(jobs).toHaveLength(0);
    expect(acks).toHaveLength(2);
  });
  it('limite de 60 min NÃO impede retroativo de 20 min: corte explícito é necessário', async () => {
    const fresh = results.fresh[0];
    if (!fresh) throw new Error('Missing future manual cart fixture');
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    const old = { ...fresh, context: { ...fresh.context, order: { ...fresh.context.order, selfservice_cart_sent_at: twentyMinutesAgo }, cart_sent_at: twentyMinutesAgo, manual_cart_before_cutover: true } };
    expect((await schedule([old], true)).jobs).toHaveLength(3);
    expect((await schedule([old])).jobs).toHaveLength(0);
  });
  it('preserva a trava de base >60 min mesmo para carrinho posterior ao corte', async () => {
    const fresh = results.fresh[0];
    if (!fresh) throw new Error('Missing future manual cart fixture');
    const staleAt = new Date(Date.now() - 61 * 60_000).toISOString();
    const stale = { ...fresh, context: { ...fresh.context, order: { ...fresh.context.order, selfservice_cart_sent_at: staleAt }, cart_sent_at: staleAt, manual_cart_before_cutover: false } };
    expect((await schedule([stale])).jobs).toHaveLength(0);
  });
  it.each(['B', 'C'])('o corte não altera a classificação nem o agendamento do %s', async type => {
    const fresh = results.fresh[0];
    if (!fresh) throw new Error('Missing cart fixture');
    const registeredAt = new Date().toISOString();
    const source = { ...fresh, context: { ...fresh.context, cart_sent_at: null,
      order: { ...fresh.context.order, selfservice_cart_sent_at: null, registered_at: registeredAt },
      access: type === 'B' ? { id: 'test-access', registered_at: registeredAt, whatsapp_confirmed_at: null } : null,
      manual_cart_before_cutover: true } };
    const after = await schedule([source]);
    const before = await schedule([source], true);
    expect(after.jobs).toHaveLength(1);
    expect(after.jobs[0]?.type).toBe(type);
    expect(after.jobs.map(row => [row.type, row.sequence_key, row.step, row.base_at])).toEqual(before.jobs.map(row => [row.type, row.sequence_key, row.step, row.base_at]));
  });
  it.each([
    ['', 'Explicit authorization'],
    ["SET app.followup_manual_apply_authorized='yes';", 'deployed scheduler'],
    ["SET app.followup_manual_apply_authorized='yes'; SET app.followup_manual_scheduler_guard_reviewed='yes'; INSERT INTO live_comments VALUES(now());", 'Live activity detected'],
  ])('recusa aplicação sem a autorização específica e a revisão exigidas: %s', (settings, message) => {
    const input = readFileSync('src/test/fixtures/liveFollowupManualCart.sql', 'utf8') + '\n' + settings + '\n' + readFileSync(prepared + 'MANUAL-CART-FIX.sql', 'utf8');
    let errorText = '';
    try {
      execFileSync('bash', ['src/test/runEventShippingIsolated.sh'], { input, encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      errorText = String((error as { stderr?: string }).stderr || error);
    }
    expect(errorText).toContain(message);
  });
});