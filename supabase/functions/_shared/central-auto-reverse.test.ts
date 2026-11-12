import { runCentralAutoReverse, centralReverseMessage, centralTestCode, CENTRAL_PENDING_TEXT } from './central-auto-reverse.ts';
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
Deno.test('fora do prazo ou sem entrega preserva o motivo da fila e não finaliza reversa', async () => {
  const f = fixture({ data: null }, [{ ok: false, error: 'Prazo de entrega ou envio não confirmado' }]);
  const out: any = await runCentralAutoReverse(f.db as any, request, f.invoke);
  assert(out.status === 'escalado' && !('reason' in out) && f.getFinish() === 0);
});
Deno.test('mensagem de devolução informa validade e estorno após recebimento', () => {
  const text = centralReverseMessage('devolucao', 'AB123456789BR', '2026-11-19');
  assert(text.includes('*AB123456789BR*') && text.includes('19/11/2026') && text.includes('estorno da compra') && text.length <= 1000);
});
Deno.test('código fictício é determinístico e tem formato de postagem', () => {
  const code = centralTestCode(request);
  assert(code === centralTestCode(request) && /^TS\d{9}BR$/.test(code));
});

Deno.test('TESTE executa somente os dois dry-runs, guarda mensagem e não finaliza reversa real', async () => {
  const invocations: any[] = []; const finishes: any[] = [];
  const db = { rpc: async (name: string, args: any) => {
    if (name === 'central_reverse_prepare') return { data: { ...prep, is_test: true }, error: null };
    if (name === 'central_test_simulation_finish') { finishes.push(args); return { data: { simulation: args.p_simulation }, error: null }; }
    throw new Error(`RPC proibida no teste: ${name}`);
  } };
  const invoke = async (name: string, body: any) => {
    invocations.push({ name, body });
    if (name === 'correios-reverse') return { data: { dry_run: true, ok: true, return_items: [{ nome: 'Tênis', valor_pago: 359.99 }] }, error: null };
    return { data: { dry_run: true, precheck_ok: true, decision: { action: 'create' }, valor_novo: 359.99, destinatario: { fonte: 'xml', nome: 'Dayse' } }, error: null };
  };
  const out: any = await runCentralAutoReverse(db as any, request, invoke, 'devolucao');
  assert(out.status === 'aguardando_postagem' && out.simulation.whatsapp_sent === false);
  assert(invocations.length === 2 && invocations.every(x => x.body.dry_run === true));
  assert(invocations[1].name === 'nfe-devolucao-emitir' && invocations[1].body.central_request_id === request);
  assert(finishes.length === 1 && out.simulation.nfe.destinatario.fonte === 'xml');
  assert(out.simulation.whatsapp_message.includes(centralTestCode(request)));
});

Deno.test('TESTE repetido reutiliza simulação e não chama nenhum serviço', async () => {
  const simulation = { dry_run: true, status: 'success', code: 'TS000000001BR', valid_until: '2026-11-19', whatsapp_sent: false };
  const db = { rpc: async () => ({ data: { ok: true, existing: true, simulation }, error: null }) };
  let invokes = 0;
  const out: any = await runCentralAutoReverse(db as any, request, async () => { invokes++; return { data: null, error: null }; });
  assert(out.existing === true && out.reverse_code === simulation.code && invokes === 0);
});

Deno.test('TESTE em andamento não dispara dry-run paralelo', async () => {
  const db = { rpc: async () => ({ data: { ok: true, existing: true, simulation: { dry_run: true, status: 'running' } }, error: null }) };
  let invokes = 0;
  const out: any = await runCentralAutoReverse(db as any, request, async () => { invokes++; return { data: null, error: null }; });
  assert(out.status === 'escalado' && invokes === 0);
});
