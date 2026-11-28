// Regras puras do alarme das filas (28/11/2026). NÃO REMOVER: um aviso por incidente, reaviso a cada N min, "normalizou" ao voltar.
export interface HealthQueue { queue: string; alarm: boolean; overdue: number; oldest_due_at: string | null; by_instance?: { instance: string; overdue: number }[]; stuck_processing?: number }
export interface Health {
  generated_at: string; overdue_minutes: number; heartbeat_minutes: number; followup_enabled: boolean;
  queues: HealthQueue[]; heartbeats: { worker: string; last_ok_at: string | null; last_error?: string | null }[];
  instances: { instance: string; paused: boolean; consecutive_errors: number; reason?: string | null }[];
}
export interface Incident { opened_at: string; last_notified_at: string | null; notify_count: number }
export const FOLLOWUP_WORKERS = ['live_followup_scheduler', 'live_followup_sender'];

export function problems(h: Health, now: number): string[] {
  const out: string[] = [];
  for (const q of h.queues) if (q.alarm && q.overdue > 0) {
    const mins = q.oldest_due_at ? Math.round((now - Date.parse(q.oldest_due_at)) / 60000) : h.overdue_minutes;
    out.push(`${LABEL[q.queue] || q.queue}: ${q.overdue} vencida(s), a mais antiga há ${mins} min`);
  }
  if (h.followup_enabled) for (const w of FOLLOWUP_WORKERS) {
    const hb = h.heartbeats.find(x => x.worker === w);
    const age = hb?.last_ok_at ? (now - Date.parse(hb.last_ok_at)) / 60000 : Infinity;
    if (age > h.heartbeat_minutes) out.push(`${LABEL[w]} sem rodar com sucesso há ${Number.isFinite(age) ? Math.round(age) + ' min' : 'tempo indeterminado'}`);
  }
  return out;
}

export type AlarmAction = { kind: 'none' } | { kind: 'open'; text: string } | { kind: 'renotify'; text: string } | { kind: 'close'; text: string };
export function decideAlarm(found: string[], open: Incident | null, now: number, renotifyMin = 30): AlarmAction {
  if (found.length && !open) return { kind: 'open', text: `⚠️ Fila de mensagens parada\n${found.join('\n')}` };
  if (found.length && open) {
    const last = open.last_notified_at ? Date.parse(open.last_notified_at) : 0;
    if (now - last >= renotifyMin * 60000) return { kind: 'renotify', text: `⚠️ Fila ainda parada (desde ${hhmm(open.opened_at)})\n${found.join('\n')}` };
    return { kind: 'none' };
  }
  if (!found.length && open) return { kind: 'close', text: `✅ Fila normalizou (parada desde ${hhmm(open.opened_at)})` };
  return { kind: 'none' };
}

/** Instâncias envolvidas no problema não servem para mandar o alarme. */
export function pickAlarmSender(numbers: { id: string; provider: string; is_active: boolean; is_online: boolean | null }[], h: Health) {
  const bad = new Set<string>();
  for (const q of h.queues) for (const b of q.by_instance || []) if (b.overdue > 0) bad.add(b.instance);
  for (const i of h.instances) bad.add(i.instance);
  const ok = numbers.filter(n => n.is_active && n.is_online !== false && ['uazapi', 'wasender', 'zapi'].includes(n.provider));
  return ok.find(n => !bad.has(n.id)) || null;
}

function hhmm(iso: string) { return new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(11, 16); }
const LABEL: Record<string, string> = {
  live_followup_jobs: 'Follow-ups da live', selfservice_message_queue: 'Fila do carrinho/autoatendimento',
  support_outbox: 'Respostas do suporte', automation_message_queue: 'Automações',
  live_followup_scheduler: 'Agendador dos follow-ups', live_followup_sender: 'Enviador dos follow-ups',
};

/** Resposta do vigia externo: só contagens e tempos. */
export function publicHealth(h: Health, now: number) {
  const found = problems(h, now);
  return {
    ok: found.length === 0, generated_at: h.generated_at, overdue_minutes: h.overdue_minutes,
    queues: h.queues.map(q => ({ queue: q.queue, alarm: q.alarm, overdue: q.overdue, oldest_overdue_minutes: q.oldest_due_at ? Math.round((now - Date.parse(q.oldest_due_at)) / 60000) : 0, stuck_processing: q.stuck_processing ?? 0 })),
    workers: h.heartbeats.map(b => ({ worker: b.worker, minutes_since_ok: b.last_ok_at ? Math.round((now - Date.parse(b.last_ok_at)) / 60000) : null, failing: !!b.last_error })),
    paused_instances: h.instances.filter(i => i.paused).length,
    problems: found.length,
  };
}
