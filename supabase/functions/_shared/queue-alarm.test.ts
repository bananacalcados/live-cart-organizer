import { assertEquals } from 'jsr:@std/assert@1';
import { decideAlarm, pickAlarmSender, problems, publicHealth, type Health } from './queue-alarm.ts';
const now = Date.parse('2026-11-28T20:00:00Z');
const base = (over: Partial<Health> = {}): Health => ({ generated_at: new Date(now).toISOString(), overdue_minutes: 10, heartbeat_minutes: 5, followup_enabled: true,
  queues: [{ queue: 'live_followup_jobs', alarm: true, overdue: 0, oldest_due_at: null, by_instance: [] }],
  heartbeats: [{ worker: 'live_followup_scheduler', last_ok_at: new Date(now - 60000).toISOString() }, { worker: 'live_followup_sender', last_ok_at: new Date(now - 60000).toISOString() }],
  instances: [], ...over });

Deno.test('alarme dispara, não repete, reavisa em 30 min e normaliza', () => {
  const h = base({ queues: [{ queue: 'live_followup_jobs', alarm: true, overdue: 3, oldest_due_at: new Date(now - 25 * 60000).toISOString(), by_instance: [{ instance: 'x', overdue: 3 }] }] });
  const f = problems(h, now); assertEquals(f.length, 1);
  assertEquals(decideAlarm(f, null, now).kind, 'open');
  const inc = { opened_at: new Date(now).toISOString(), last_notified_at: new Date(now).toISOString(), notify_count: 1 };
  assertEquals(decideAlarm(f, inc, now + 60000).kind, 'none');
  assertEquals(decideAlarm(f, inc, now + 30 * 60000).kind, 'renotify');
  assertEquals(decideAlarm([], inc, now + 31 * 60000).kind, 'close');
  assertEquals(decideAlarm([], null, now).kind, 'none');
});
Deno.test('enviador/agendador sem batimento há mais de 5 min vira problema', () => {
  const h = base({ heartbeats: [{ worker: 'live_followup_scheduler', last_ok_at: new Date(now - 6 * 60000).toISOString() }] });
  assertEquals(problems(h, now).length, 2);
  assertEquals(problems({ ...h, followup_enabled: false }, now).length, 0);
});
Deno.test('alarme sai por instância fora do problema', () => {
  const h = base({ queues: [{ queue: 'live_followup_jobs', alarm: true, overdue: 1, oldest_due_at: null, by_instance: [{ instance: 'travada', overdue: 1 }] }] });
  const s = pickAlarmSender([{ id: 'travada', provider: 'uazapi', is_active: true, is_online: true }, { id: 'meta', provider: 'meta', is_active: true, is_online: true }, { id: 'livre', provider: 'uazapi', is_active: true, is_online: true }], h);
  assertEquals(s?.id, 'livre');
});
Deno.test('resposta do vigia não traz dados de cliente', () => {
  const out = JSON.stringify(publicHealth(base(), now));
  assertEquals(/phone|instance"|message|name/.test(out), false);
});
