import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

let result: Record<string, any>;
beforeAll(() => {
  const beforeJob = readFileSync('docs/followups/rollback/20261128-live-followup-job-context.sql', 'utf8');
  const match = beforeJob.match(/'linked_closed',(EXISTS\(SELECT.+?\)),'initial_sent_at'/s);
  if (!match?.[1]) throw new Error('Deployed linked_closed expression not found');
  const originalExpression = match[1];
  const query = `${readFileSync('src/test/fixtures/liveFollowupManualCart.sql', 'utf8')}
    ${readFileSync('docs/followups/rollback/20261128-live-followup-dirty.sql', 'utf8')}
    ${readFileSync('docs/followups/rollback/20261128-live-followup-source-contexts.sql', 'utf8')}
    ALTER TABLE live_followup_jobs ADD COLUMN order_id uuid, ADD COLUMN access_id uuid;
    CREATE FUNCTION live_followup_job_context(p_job_id uuid) RETURNS jsonb LANGUAGE sql AS $$
      SELECT jsonb_build_object('linked_closed',${originalExpression}) FROM live_followup_jobs j
      LEFT JOIN live_selfservice_accesses a ON a.id=j.access_id WHERE j.id=p_job_id $$;
    CREATE TRIGGER dirty_insert AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION live_followup_dirty();
    CREATE TRIGGER dirty_update AFTER UPDATE ON orders FOR EACH ROW WHEN (OLD.live_followup_cart_sent_at IS DISTINCT FROM NEW.live_followup_cart_sent_at) EXECUTE FUNCTION live_followup_dirty();
    INSERT INTO events VALUES('00000000-0000-4000-8000-000000000001','test',true,NULL,NULL,'test');
    INSERT INTO orders(id,event_id,created_at,products,is_paid,paid_externally,stage,origin,live_followup_cart_sent_at) VALUES
      ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','2026-11-28 16:00:00+00','[{}]',true,false,'paid',NULL,'2026-11-28 16:15:00+00'),
      ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','2026-11-28 16:35:00+00','[{}]',false,false,'awaiting_confirmation','catalog','2026-11-28 16:38:17+00');
    INSERT INTO live_selfservice_accesses(id,event_id,order_ids) VALUES('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001',ARRAY['00000000-0000-4000-8000-000000000010'::uuid,'00000000-0000-4000-8000-000000000020'::uuid]);
    INSERT INTO live_followup_jobs(id,status,order_id,access_id) VALUES
      ('00000000-0000-4000-8000-000000000040','pending','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000030'),
      ('00000000-0000-4000-8000-000000000050','sent','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030');
    CREATE TEMP TABLE evidence(value jsonb);
    INSERT INTO evidence SELECT jsonb_build_object('before_closed',live_followup_job_context('00000000-0000-4000-8000-000000000040')->'linked_closed','before_sources',(SELECT count(*) FROM live_followup_sources),'jobs_before',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM live_followup_jobs j));
    ${process.env.FOLLOWUP_SQL_BEFORE === '1' ? '' : readFileSync('docs/followups/LIVE-MANUAL-CATALOG-APPLY.sql', 'utf8')}
    UPDATE evidence SET value=value||jsonb_build_object('after_closed',live_followup_job_context('00000000-0000-4000-8000-000000000040')->'linked_closed','own_paid_closed',live_followup_job_context('00000000-0000-4000-8000-000000000050')->'linked_closed','jobs_after',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM live_followup_jobs j));
    UPDATE orders SET live_followup_cart_sent_at=clock_timestamp() WHERE NOT is_paid;
    UPDATE evidence SET value=value||jsonb_build_object('sources',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM live_followup_source_contexts(50) s));
    SELECT 'LIVE_APPLY_JSON:'||value::text FROM evidence;`;
  const output = execFileSync('bash', ['src/test/runEventShippingIsolated.sh'], { input: query, encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] });
  const line = output.split('\n').find(row => row.startsWith('LIVE_APPLY_JSON:'));
  if (!line) throw new Error('No isolated SQL evidence');
  result = JSON.parse(line.slice('LIVE_APPLY_JSON:'.length));
}, 120_000);

describe('SQL autorizado — pedido manual/catálogo e acesso de cliente recorrente', () => {
  it('a definição anterior fecha indevidamente o segundo pedido pelo primeiro pago', () => { expect(result.before_closed).toBe(true); });
  it('a definição corrigida não fecha o segundo pedido aberto', () => { expect(result.after_closed).toBe(false); });
  it('pedido que está pago continua fechado para cobrança', () => { expect(result.own_paid_closed).toBe(true); });
  it('gatilho antigo não deixa fonte; catálogo novo deixa uma fonte após a correção', () => {
    expect(result.before_sources).toBe(0);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.context.order.origin).toBe('catalog');
  });
  it('o corte é fixo no contexto e o carrinho novo está depois dele', () => {
    const source = result.sources[0];
    expect(Date.parse(source?.context.cart_followup_cutover_at)).toBeGreaterThan(0);
    expect(Date.parse(source?.context.order.selfservice_cart_sent_at)).toBeGreaterThanOrEqual(Date.parse(source?.context.cart_followup_cutover_at));
  });
  it('a migração não altera nenhum job existente', () => { expect(result.jobs_after).toEqual(result.jobs_before); });
});