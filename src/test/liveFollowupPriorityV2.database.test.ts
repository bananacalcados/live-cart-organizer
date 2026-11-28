import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Prioridade dos follow-ups v2 — PostgreSQL descartável', () => {
  interface Result { scenario: string; d_first_total: number; d_first_sent: number; d_first_max_minutes: number; a: number; b: number; c: number; no_spare_second: number; no_spare_third: number; late_first: number; pending: number; max_claims_hour: number }
  let results: Result[] = [];
  beforeAll(() => {
    const output = execFileSync('bash', ['src/test/runLiveShownReappear.sh', 'liveFollowupPriorityV2.database.sql'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
    });
    const line = output.split('\n').find(row => row.trim().startsWith('LOAD_JSON:'));
    if (!line) throw new Error('The real SQL simulation produced no load results');
    results = JSON.parse(line.trim().slice('LOAD_JSON:'.length));
  }, 120_000);
  it.each(['300 mixed / 1 live', '300 mixed / 2 independent lives'])('%s preserva todos os 75 primeiros D dentro dos 15 min', scenario => {
    const result = results.find(row => row.scenario === scenario);
    expect(result?.d_first_total).toBe(75);
    expect(result?.d_first_sent).toBe(75);
    expect(result?.d_first_max_minutes).toBeLessThanOrEqual(15);
  });
  it.each(['300 mixed / 1 live', '300 mixed / 2 independent lives'])('%s registra os 50 segundos e 50 terceiros D sem folga', scenario => {
    const result = results.find(row => row.scenario === scenario);
    expect(result?.no_spare_second).toBe(50);
    expect(result?.no_spare_third).toBe(50);
  });
  it('mantém o teto de 80 por número por hora em todas as cargas e não deixa pendências', () => {
    expect(results.length).toBe(6);
    for (const row of results) {
      expect(row.max_claims_hour).toBeLessThanOrEqual(80);
      expect(row.pending).toBe(0);
    }
  });
  it('a carga não descarta A/B/C: 40/40/35 saem após drenar o pico', () => {
    const result = results.find(row => row.scenario === '300 mixed / 1 live');
    expect([result?.a, result?.b, result?.c]).toEqual([40, 40, 35]);
  });
  it('expõe, em vez de esconder, a limitação do pico prolongado de 80/h', () => {
    const result = results.find(row => row.scenario === 'only first D / 80 per hour for 6h');
    expect(result?.d_first_total).toBe(480);
    expect(result?.late_first).toBeGreaterThan(0);
    expect(result?.d_first_sent).toBeLessThan(480);
  });
  it.each(['orders', 'live_comments'])('recusa implantar quando há atividade recente em %s', table => {
    const fixture = `CREATE TABLE orders(event_id uuid,created_at timestamptz);CREATE TABLE live_comments(created_at timestamptz);
      ${table === 'orders' ? "INSERT INTO orders VALUES(gen_random_uuid(),now());" : 'INSERT INTO live_comments VALUES(now());'}
      ${readFileSync('docs/followups/PRIORIDADE-V2.sql', 'utf8')}`;
    let errorText = '';
    try {
      execFileSync('bash', ['src/test/runEventShippingIsolated.sh'], { input: fixture, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      errorText = String((error as { stderr?: string }).stderr || error);
    }
    expect(errorText).toContain('Live activity detected');
  });
});