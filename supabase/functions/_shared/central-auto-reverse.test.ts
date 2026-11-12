import { runCentralAutoReverse, centralReverseMessage, CENTRAL_PENDING_TEXT } from './central-auto-reverse.ts';
const assert = (v: boolean) => { if (!v) throw new Error('assertion failed'); };
const request = '00000000-0000-4000-8000-000000000001';
const reverse = '00000000-0000-4000-8000-000000000002';
const prep = { ok: true, idempotency_key: `central-${request}`, sale_id: crypto.randomUUID(), service_code: '03301', reason: 'tamanho', request_type: 'troca', return_items: [], customer: { nome: 'Cliente Teste' } };
function fixture(result: any, preparations: any[] = [prep]) {
  const calls: any[] = []; let finish = 0;
  const db = { rpc: async (name: string, args: any) => {
    calls.push({ name, args });
    if (name === 'central_reverse_prepare') return { data: preparations.shift(), error: null };
    if (name === 'central_reverse_finish') { finish++; return { data: { ok: !args.p_error, status: args.p_error ? 'escalado' : 'aguardando_postagem' }, error: null }; }
    return { data: null, error: null };
  } };
  const invoke = async () => ({ data: result.data, error: result.error || null });
  return { db, invoke, calls, getFinish: () => finish };
}

Deno.test('central automática: sucesso gera código, mensagem e uma finalização', async () => {
  const f = fixture({ data: { item: { id: reverse, codigo_objeto: 'AB123456789BR', valid_until: '2026-11-19' } } });
  const out: any = await runCentralAutoReverse(f.db as any, request, f.invoke);
  assert(out.status === 'aguardando_postagem' && out.reverse_code === 'AB123456789BR');
  const done = f.calls.find(x => x.name === 'central_reverse_finish');
  assert(done.args.p_code === 'AB123456789BR' && done.args.p_message.includes('2 dias úteis'));
});
Deno.test('central automática: falha da pré-checagem vai para fila com texto seguro', async () => {
  const f = fixture({ data: { error: 'Nota de devolução não enviada: CEP obrigatório' } });
  const out: any = await runCentralAutoReverse(f.db as any, request, f.invoke);
  assert(out.reason === CENTRAL_PENDING_TEXT && !out.reason.includes('CEP'));
  assert(f.getFinish() === 1);
});
Deno.test('central automática: falha dos Correios não inventa código', async () => {
  const f = fixture({ data: null, error: 'Correios indisponíveis' });
  const out: any = await runCentralAutoReverse(f.db as any, request, f.invoke);
  assert(out.status === 'escalado' && !('reverse_code' in out));
});
Deno.test('central automática: clique duplo usa a mesma chave e não chama Correios de novo', async () => {
  const f = fixture({ data: null }, [{ ok: true, existing: true, reverse_code: 'AB123456789BR' }]);
  let invokes = 0; const invoke = async () => { invokes++; return { data: null, error: null }; };
  const out: any = await runCentralAutoReverse(f.db as any, request, invoke);
  assert(out.reverse_code === 'AB123456789BR' && invokes === 0 && f.getFinish() === 0);
});
Deno.test('central automática: corrida existente sem código não gera segunda reversa', async () => {
  const f = fixture({ data: null }, [{ ok: false, pending: true, error: 'em processamento' }]);
  let invokes = 0; const invoke = async () => { invokes++; return { data: null, error: null }; };
  const out: any = await runCentralAutoReverse(f.db as any, request, invoke);
  assert(out.status === 'escalado' && invokes === 0);
});
Deno.test('mensagem de devolução informa validade e estorno após recebimento', () => {
  const text = centralReverseMessage('devolucao', 'AB123456789BR', '2026-11-19');
  assert(text.includes('*AB123456789BR*') && text.includes('19/11/2026') && text.includes('estorno da compra') && text.length <= 1000);
});
