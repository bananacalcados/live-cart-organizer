import { assert, assertEquals } from 'jsr:@std/assert@1';
import { runInstanceLoops, dStepAction, D_STEP_SKIP_REASON } from './live-followup-v2.ts';

// Relógio virtual: avança só quando todos os laços estão esperando.
class Clock {
  t = 0; timers: { at: number; r: () => void }[] = [];
  now = () => this.t;
  sleep = (ms: number) => new Promise<void>(r => this.timers.push({ at: this.t + ms, r }));
  async run<T>(p: Promise<T>): Promise<T> {
    let done = false, out!: T; p.then(v => { done = true; out = v; });
    while (!done) {
      for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
      if (done) break;
      this.timers.sort((a, b) => a.at - b.at);
      const n = this.timers.shift(); if (!n) continue;
      this.t = Math.max(this.t, n.at); n.r();
    }
    return out;
  }
}
function rng(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); }

interface Job { id: number; inst: string; due: number; type: string; status: string; sentAt?: number }
/** Fila simulada com as mesmas travas da reserva no banco (ritmo 20–60 s, teto/hora, D atrasado >15 min pula). */
function fakeDb(jobs: Job[], clock: Clock, sendMs: Record<string, number>, opts: { hourly?: number; uncertainIds?: Set<number>; random?: () => number } = {}) {
  const next: Record<string, number> = {}; const claims: Record<string, number[]> = {}; const random = opts.random || Math.random;
  const providerCalls: number[] = [];
  return {
    providerCalls,
    deps: {
      now: clock.now, sleep: clock.sleep,
      claim: async (inst: string) => {
        const t = clock.now();
        if ((next[inst] || 0) > t) return null;
        if (jobs.some(j => j.inst === inst && j.status === 'processing')) return null;
        if ((claims[inst] || []).filter(c => c > t - 3600_000).length >= (opts.hourly ?? 80)) return null;
        for (const j of jobs.filter(j => j.inst === inst && j.status === 'pending' && j.due <= t).sort((a, b) => a.due - b.due)) {
          if (j.type === 'D' && t > j.due + 15 * 60_000) { j.status = 'skipped_late'; continue; }
          next[inst] = t + (20 + Math.floor(random() * 41)) * 1000;
          (claims[inst] ||= []).push(t); j.status = 'processing'; return j;
        }
        return null;
      },
      process: async (j: Job) => {
        await clock.sleep(sendMs[j.inst]);
        providerCalls.push(j.id);
        if (opts.uncertainIds?.has(j.id)) { j.status = 'uncertain'; return false; }
        j.status = 'sent'; j.sentAt = clock.now(); return true;
      },
      nextSendAt: async (inst: string) => next[inst] || clock.now(),
      hasDue: async (inst: string) => jobs.some(j => j.inst === inst && j.status === 'pending' && j.due <= clock.now()),
    },
  };
}
async function cron(clock: Clock, jobs: Job[], db: ReturnType<typeof fakeDb>, minutes: number) {
  for (let m = 0; m < minutes; m++) {
    const start = m * 60_000; if (clock.t < start) { const s = clock.sleep(start - clock.t); await clock.run(s); }
    const insts = [...new Set(jobs.filter(j => j.status === 'pending' && j.due <= clock.t).map(j => j.inst))];
    await clock.run(runInstanceLoops(insts, db.deps, 55_000));
  }
}

Deno.test('instância lenta não atrasa a outra', async () => {
  const clock = new Clock();
  const jobs: Job[] = [];
  for (let i = 0; i < 20; i++) { jobs.push({ id: i, inst: 'lenta', due: 0, type: 'A', status: 'pending' }); jobs.push({ id: 100 + i, inst: 'rapida', due: 0, type: 'A', status: 'pending' }); }
  const db = fakeDb(jobs, clock, { lenta: 25_000, rapida: 2_000 }, { random: () => 0 });
  await cron(clock, jobs, db, 6);
  const fast = jobs.filter(j => j.inst === 'rapida' && j.status === 'sent').length;
  const alone = new Clock(); const jobs2 = jobs.filter(j => j.inst === 'rapida').map(j => ({ ...j, status: 'pending', sentAt: undefined }));
  const db2 = fakeDb(jobs2, alone, { rapida: 2_000 }, { random: () => 0 }); await cron(alone, jobs2, db2, 6);
  assertEquals(fast, jobs2.filter(j => j.status === 'sent').length);
  assert(fast >= 8, `rápida enviou ${fast}`);
});

Deno.test('resposta incerta não reenvia e não trava as seguintes', async () => {
  const clock = new Clock();
  const jobs: Job[] = [0, 1, 2].map(i => ({ id: i, inst: 'a', due: 0, type: 'A', status: 'pending' }));
  const db = fakeDb(jobs, clock, { a: 1000 }, { uncertainIds: new Set([0]), random: () => 0 });
  await cron(clock, jobs, db, 3);
  assertEquals(db.providerCalls.filter(x => x === 0).length, 1);
  assertEquals(jobs[0].status, 'uncertain');
  assertEquals(jobs.filter(j => j.status === 'sent').length, 2);
});

Deno.test('erro numa mensagem não para o laço', async () => {
  const clock = new Clock(); let n = 0;
  const r = await clock.run(runInstanceLoops(['a'], {
    now: clock.now, sleep: clock.sleep,
    claim: async () => (n < 3 ? { id: n++ } : null), process: async (j: any) => { if (j.id === 0) throw new Error('x'); return true; },
    nextSendAt: async () => null, hasDue: async () => false,
  }, 50_000));
  assertEquals(r.processed, 3); assertEquals(r.sent, 2);
});

Deno.test('job preso é retomado: reserva expirada libera a instância (modelo do banco)', async () => {
  // O banco marca processing >10 min como processing_expirado; aqui: reserva vazia enquanto há processing, liberada depois.
  const clock = new Clock();
  const jobs: Job[] = [{ id: 1, inst: 'a', due: 0, type: 'A', status: 'processing' }, { id: 2, inst: 'a', due: 0, type: 'A', status: 'pending' }];
  const db = fakeDb(jobs, clock, { a: 1000 }, { random: () => 0 });
  await cron(clock, jobs, db, 1); assertEquals(jobs[1].status, 'pending');
  jobs[0].status = 'processing_expirado';
  await cron(clock, jobs, db, 3); assertEquals(jobs[1].status, 'sent');
});

Deno.test('regra do D: pula só a etapa respondida', () => {
  // respondeu entre a 1ª e a 2ª → 2ª pula; 3ª sai (sem nova resposta desde o último envio real).
  assertEquals(dStepAction(false), 'send');
  assertEquals(dStepAction(true), 'skip_step');
  assertEquals(D_STEP_SKIP_REASON, 'respondeu_desde_envio_anterior');
});

Deno.test('carga de dia de live: 300 jobs em 1h, 2 instâncias — mede atraso', async () => {
  const clock = new Clock(); const r = rng(42);
  const jobs: Job[] = Array.from({ length: 300 }, (_, i) => ({ id: i, inst: i % 2 ? 'a' : 'b', due: Math.floor(r() * 3600_000), type: ['A', 'C', 'D', 'D'][i % 4], status: 'pending' }));
  const db = fakeDb(jobs, clock, { a: 6_000, b: 9_000 }, { random: r });
  await cron(clock, jobs, db, 180);
  const sent = jobs.filter(j => j.status === 'sent');
  const delays = sent.map(j => (j.sentAt! - j.due) / 60000).sort((a, b) => a - b);
  const report = { sent: sent.length, late_skipped: jobs.filter(j => j.status === 'skipped_late').length, pending: jobs.filter(j => j.status === 'pending').length, p50: delays[Math.floor(delays.length / 2)].toFixed(1), p95: delays[Math.floor(delays.length * 0.95)].toFixed(1), max: delays.at(-1)!.toFixed(1) };
  console.log('CARGA', JSON.stringify(report));
  assertEquals(report.pending, 0);
  assert(sent.length + report.late_skipped === 300);
});

Deno.test('comparação: mesma carga no enviador antigo (lote sequencial, 1 por instância por minuto)', async () => {
  const clock = new Clock(); const r = rng(42);
  const jobs: Job[] = Array.from({ length: 300 }, (_, i) => ({ id: i, inst: i % 2 ? 'a' : 'b', due: Math.floor(r() * 3600_000), type: ['A', 'C', 'D', 'D'][i % 4], status: 'pending' }));
  const db = fakeDb(jobs, clock, { a: 6_000, b: 9_000 }, { random: r });
  for (let m = 0; m < 180; m++) {
    const start = m * 60_000; if (clock.t < start) await clock.run(clock.sleep(start - clock.t));
    const claimed: Job[] = []; for (const inst of ['a', 'b']) { const j = await db.deps.claim(inst); if (j) claimed.push(j); }
    await clock.run((async () => { for (const j of claimed) await db.deps.process(j); })());
  }
  const sent = jobs.filter(j => j.status === 'sent'); const d = sent.map(j => (j.sentAt! - j.due) / 60000).sort((a, b) => a - b);
  console.log('CARGA_V1', JSON.stringify({ sent: sent.length, late_skipped: jobs.filter(j => j.status === 'skipped_late').length, pending: jobs.filter(j => j.status === 'pending').length, p50: d[Math.floor(d.length / 2)]?.toFixed(1), max: d.at(-1)?.toFixed(1) }));
});
