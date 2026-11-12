import { supportOutboxPreflight, supportOutboxFunction, SUPPORT_OUTBOX_INSTANCES } from './support-outbox.ts';
const assert = (v: boolean) => { if (!v) throw new Error('assertion failed'); };
const base = { instanceId: SUPPORT_OUTBOX_INSTANCES[0], provider: 'uazapi', phone: '5533999999999', text: 'Teste', sentLastHour: 0, now: Date.parse('2026-11-12T12:00:00Z') };

Deno.test('outbox aceita as quatro instâncias e rejeita qualquer outra', () => {
  for (const id of SUPPORT_OUTBOX_INSTANCES) assert(supportOutboxPreflight({ ...base, instanceId: id }) === null);
  assert(/não permitida/.test(supportOutboxPreflight({ ...base, instanceId: crypto.randomUUID() }) || ''));
});
Deno.test('outbox Meta exige entrada da cliente nas últimas 24 horas', () => {
  const meta = { ...base, provider: 'meta', instanceId: SUPPORT_OUTBOX_INSTANCES[1] };
  assert(supportOutboxPreflight({ ...meta, incomingAt: '2026-11-11T12:00:00Z' }) === null);
  assert(/24 horas/.test(supportOutboxPreflight({ ...meta, incomingAt: '2026-11-11T11:59:59Z' }) || ''));
  assert(/24 horas/.test(supportOutboxPreflight({ ...meta, incomingAt: null }) || ''));
});
Deno.test('outbox limita a trinta envios por hora', () => {
  assert(supportOutboxPreflight({ ...base, sentLastHour: 29 }) === null);
  assert(/30 envios/.test(supportOutboxPreflight({ ...base, sentLastHour: 30 }) || ''));
});
Deno.test('outbox limita texto mais link a mil caracteres', () => {
  assert(supportOutboxPreflight({ ...base, text: 'x'.repeat(1000) }) === null);
  assert(/1.000/.test(supportOutboxPreflight({ ...base, text: 'x'.repeat(1001) }) || ''));
  assert(/1.000/.test(supportOutboxPreflight({ ...base, text: 'x'.repeat(990), link: 'https://exemplo.com/12345678901' }) || ''));
});
Deno.test('outbox usa o provedor real da instância', () => {
  assert(supportOutboxFunction('uazapi') === 'uazapi-send-message');
  assert(supportOutboxFunction('meta') === 'meta-whatsapp-send');
  assert(supportOutboxFunction('wasender') === 'wasender-send-message');
  assert(supportOutboxFunction('zapi') === 'zapi-send-message');
  assert(supportOutboxFunction('outro') === null);
});
