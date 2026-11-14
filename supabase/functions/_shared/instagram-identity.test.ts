import { assertEquals } from 'jsr:@std/assert';
import { rememberInstagramIdentity } from './instagram-identity.ts';

function fakeDb(existing: Record<string, unknown> | null) {
  const calls: { kind: string; values: Record<string, unknown> }[] = [];
  const table = {
    select() { return this; },
    eq() { return this; },
    limit() { return this; },
    async maybeSingle() { return { data: existing, error: null }; },
    update(values: Record<string, unknown>) {
      calls.push({ kind: 'update', values });
      return { eq: async () => ({ error: null }) };
    },
    async insert(values: Record<string, unknown>) {
      calls.push({ kind: 'insert', values });
      return { error: null };
    },
  };
  return { calls, from: () => table };
}

Deno.test('vínculo novo é criado com @ normalizado e ID do provedor', async () => {
  const db = fakeDb(null);
  await rememberInstagramIdentity(db, { username: '@Cliente.Teste', igUserId: '123', source: 'webhook_dm', seenAt: '2026-11-14T00:00:00Z' });
  assertEquals(db.calls, [{ kind: 'insert', values: { username: 'cliente.teste', ig_user_id: '123', source: 'webhook_dm', last_seen_at: '2026-11-14T00:00:00Z' } }]);
});

Deno.test('histórico antigo não substitui um vínculo mais recente', async () => {
  const db = fakeDb({ id: '1', ig_user_id: 'novo', last_seen_at: '2026-11-14 00:00:00+00' });
  await rememberInstagramIdentity(db, { username: 'cliente', igUserId: 'antigo', source: 'instagram_backfill', seenAt: '2026-11-09T00:00:00Z' });
  assertEquals(db.calls, []);
});

Deno.test('mensagem mais recente atualiza o vínculo existente', async () => {
  const db = fakeDb({ id: '1', ig_user_id: 'antigo', last_seen_at: '2026-11-08 00:00:00+00' });
  await rememberInstagramIdentity(db, { username: 'cliente', igUserId: 'novo', source: 'webhook_dm', seenAt: '2026-11-14T00:00:00Z' });
  assertEquals(db.calls, [{ kind: 'update', values: { ig_user_id: 'novo', previous_ig_user_ids: ['antigo'], source: 'webhook_dm', last_seen_at: '2026-11-14T00:00:00Z' } }]);
});
