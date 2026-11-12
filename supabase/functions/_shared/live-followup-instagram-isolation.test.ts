import { assertEquals } from 'jsr:@std/assert';
import { scheduleGlobalFollowups } from './live-followup.ts';

const eventId = '8acab97e-9d47-4203-93b6-d8c8a1a4652e';
const instagramId = '531883b0-b8bc-48b9-a094-edb04a7a0478';

function source(key: string, handle: string) {
  return {
    source_key: key,
    changed_at: new Date().toISOString(),
    context: {
      event: { id: eventId, live_followup_enabled: true },
      order: {
        id: key,
        created_at: new Date().toISOString(),
        registered_at: null,
        origin: 'live',
        products: [{ name: 'produto' }],
        stage: 'incomplete_order',
        is_paid: false,
        paid_externally: false,
      },
      access: null,
      registration: null,
      customer: { instagram_handle: handle, whatsapp: null, full_name: null },
      ig_instance_id: null,
    },
  };
}

Deno.test('erro no Instagram de um item não descarta nem impede os outros do lote', async () => {
  const upserts: any[] = [];
  const acknowledged: string[] = [];
  let instagramCalls = 0;
  const sb: any = {
    rpc: async (name: string) => {
      if (name === 'live_followup_source_contexts') return { data: [source('source-erro', 'falha'), source('source-ok', 'ok')], error: null };
      if (name === 'instagram_reply_context') {
        instagramCalls++;
        return instagramCalls === 1
          ? { data: null, error: new Error('falha simulada') }
          : { data: { number_id: instagramId }, error: null };
      }
      throw new Error(`RPC inesperada: ${name}`);
    },
    from: (table: string) => {
      if (table === 'live_followup_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { value: { enabled: true, enabled_since: '2026-01-01T00:00:00Z', types: { F: { enabled: true, steps: [{ minutes: 2, variants: ['Oi!'] }] } } } },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'live_followup_jobs') {
        return { upsert: async (rows: any[]) => { upserts.push(...rows); return { error: null }; } };
      }
      if (table === 'live_followup_sources') {
        return { delete: () => ({ eq: (_field: string, value: string) => { acknowledged.push(value); return { eq: async () => ({ error: null }) }; } }) };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };

  const result = await scheduleGlobalFollowups(sb);
  assertEquals(result.scheduled, 1);
  assertEquals(result.deferred, 1);
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].order_id, 'source-ok');
  assertEquals(upserts[0].whatsapp_number_id, instagramId);
  assertEquals(acknowledged, ['source-ok']);
});
