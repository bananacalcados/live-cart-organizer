Deno.env.set('INTERNAL_FN_SECRET', 'teste-falso'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'teste-falso');
import { planGuardTick, isTransientSendError, shadowAutoRecoverable, type GuardStatus } from './support-guard.ts';
import { processSupportOutbox } from './support-outbox.ts';
const assert = (v: boolean, m = 'assertion failed') => { if (!v) throw new Error(m); };
const NOW = Date.parse('2026-11-17T15:00:00Z');
const base: GuardStatus = { mode: 'auto', shadow_auto: false, shadow_reason: null, shadow_at: null, paused: [], triage_total: 0, triage_failed: 0, alert_configured: true, alert_state: null, alert_last_sent_at: null };

Deno.test('erro HTML da plataforma é transitório; erro da Meta não', () => {
  assert(isTransientSendError(`{"error":"Internal server error","details":"Unexpected token '<', \\"<html>"}`));
  assert(isTransientSendError('instagram-dm-send respondeu HTTP 502 sem JSON'));
  assert(!isTransientSendError('Fora da janela de 24 horas da Meta'));
  assert(!isTransientSendError('Acesso do Instagram vencido'));
});
Deno.test('volta sozinha só de sombra automática, após 30 min, triagem saudável e número de alerta', () => {
  const s = { ...base, mode: 'shadow', shadow_auto: true, shadow_reason: 'Falha na caixa de saída', shadow_at: new Date(NOW - 31 * 60_000).toISOString() };
  assert(planGuardTick(s, NOW).tryRecover);
  assert(!planGuardTick({ ...s, shadow_auto: false }, NOW).tryRecover, 'mexeu em sombra manual');
  assert(!planGuardTick({ ...s, shadow_at: new Date(NOW - 29 * 60_000).toISOString() }, NOW).tryRecover, 'antes de 30 min');
  assert(!planGuardTick({ ...s, triage_total: 6, triage_failed: 4 }, NOW).tryRecover, 'triagem doente');
  assert(!planGuardTick({ ...s, alert_configured: false }, NOW).tryRecover, 'sem envio de teste');
  assert(!shadowAutoRecoverable('Falha na reversa/NF da Central: x'), 'NF/Correios voltou sozinho');
});
Deno.test('aviso: no máximo 1 a cada 30 min e outro quando normaliza', () => {
  const paused = { ...base, paused: [{ id: 'i1', name: '@bananacalcados', until: new Date(NOW + 600_000).toISOString(), reason: '3 falhas' }] };
  assert(planGuardTick(paused, NOW).alert === 'problem');
  assert(planGuardTick({ ...paused, alert_state: 'canal:i1' }, NOW).alert === null, 'repetiu o mesmo aviso');
  assert(planGuardTick({ ...paused, alert_state: 'shadow', alert_last_sent_at: new Date(NOW - 10 * 60_000).toISOString() }, NOW).alert === null, 'passou do limite de 30 min');
  assert(planGuardTick({ ...base, alert_state: 'canal:i1', alert_last_sent_at: new Date(NOW - 60_000).toISOString() }, NOW).alert === 'normal');
  assert(planGuardTick({ ...base, triage_total: 6, triage_failed: 4 }, NOW).issues.some((i) => i.key === 'triagem'));
  assert(planGuardTick({ ...base, mode: 'shadow', shadow_auto: false }, NOW).alert === null, 'sombra manual gerou alerta');
});

function fakeDb(sendResults: any[], outgoingAfterFail = false) {
  const calls: any = { invokes: 0, rpcs: [] as string[], updates: [] as any[] };
  const q = (table: string) => {
    const b: any = { _t: table, _u: null };
    for (const k of ['select', 'eq', 'gte', 'in', 'limit']) b[k] = () => b;
    b.update = (u: any) => { b._u = u; calls.updates.push({ table, u }); return b; };
    b.insert = async () => ({ error: null });
    b.then = (res: any) => res(table === 'whatsapp_numbers'
      ? { data: [{ id: 'ig', provider: 'instagram', is_active: true }, { id: 'wa', provider: 'uazapi', is_active: true }], error: null }
      : table === 'whatsapp_messages' ? { data: outgoingAfterFail ? [{ message_id: 'm1' }] : [], error: null } : { data: null, error: null });
    return b;
  };
  return {
    calls,
    rpc: async (n: string) => { calls.rpcs.push(n); return n === 'support_outbox_claim' ? { data: [
      { id: 'j1', whatsapp_number_id: 'ig', phone: '1147294578154336', text: 'oi', claimed_at: 'x' },
      { id: 'j2', whatsapp_number_id: 'wa', phone: '5533999999999', text: 'oi', claimed_at: 'x' },
    ], error: null } : { data: null, error: null }; },
    from: q,
    functions: { invoke: async () => { calls.invokes++; return sendResults.shift() ?? { data: { success: true, messageId: 'ok' }, error: null }; } },
  };
}
const html = { data: { error: 'Internal server error', details: "Unexpected token '<', \"<html>" }, error: null };
Deno.test('1 falha de envio não derruba o automático e os outros canais seguem', async () => {
  const db = fakeDb([{ data: { error: 'Acesso do Instagram vencido' }, error: null }]);
  const r = await processSupportOutbox(db, { wait: async () => {} });
  assert(r.failed === 1 && r.sent === 1, JSON.stringify(r));
  assert(!db.calls.rpcs.includes('support_emergency_pause'), 'chamou trava geral');
  assert(db.calls.invokes === 1 + 1, 'erro da Meta foi repetido');
});
Deno.test('erro HTML no Instagram tenta 3 vezes antes de marcar falha', async () => {
  const db = fakeDb([html, html, html]);
  const r = await processSupportOutbox(db, { wait: async () => {} });
  assert(db.calls.invokes === 3 + 1 && r.failed === 1, JSON.stringify({ r, i: db.calls.invokes }));
  const fail = db.calls.updates.find((x: any) => x.u.status === 'failed');
  assert(/3 tentativas|tentativa/.test(fail.u.error), fail.u.error);
});
Deno.test('erro HTML que já saiu (histórico confirma) não reenvia', async () => {
  const db = fakeDb([html], true);
  const r = await processSupportOutbox(db, { wait: async () => {} });
  assert(db.calls.invokes === 1 + 1 && r.sent === 2, JSON.stringify(r));
});
