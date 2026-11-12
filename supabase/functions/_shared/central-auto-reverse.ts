export const CENTRAL_PENDING_TEXT = 'Recebemos seu pedido e vamos te mandar o código em breve.';

export function centralReverseMessage(type: 'troca' | 'devolucao', code: string, validUntil: string) {
  const valid = new Date(`${validUntil.slice(0, 10)}T12:00:00-03:00`).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const after = type === 'troca'
    ? 'O envio da troca é feito em até 2 dias úteis após o recebimento do produto em nossa loja.'
    : 'O estorno da compra é feito em até 2 dias úteis após o recebimento do produto em nossa loja.';
  return `Oi! Seu código de postagem é *${code}* 😃\n\nValidade: *${valid}*.\n\nColoque o produto em uma caixa (pode ser a original), embale bem e lacre. Depois, leve a uma agência dos Correios e apresente o código. A postagem é gratuita.\n\n${after}`;
}

type Db = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
type Invoke = (name: string, body: Record<string, unknown>) => Promise<{ data: any; error: string | null }>;

async function rpc(db: Db, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(typeof error === 'string' ? error : error.message || 'Falha no registro da reversa');
  return data;
}

/** Orquestra somente dados confirmados pelo banco. Toda escrita externa usa a chave central-<request>. */
export async function runCentralAutoReverse(db: Db, requestId: string, invoke: Invoke, requestType: 'troca' | 'devolucao' = 'troca') {
  let prep: any;
  try {
    prep = await rpc(db, 'central_reverse_prepare', { p_request_id: requestId });
  } catch (e) {
    prep = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (prep?.skipped || /TESTE/i.test(prep?.error || '')) return null;
  if (prep?.existing && prep?.reverse_code) return { status: 'aguardando_postagem', reverse_code: prep.reverse_code };
  if (!prep?.ok || prep?.pending) {
    const reason = String(prep?.error || 'Reversa em andamento').slice(0, 800);
    if (!prep?.pending) await rpc(db, 'central_reverse_finish', { p_request_id: requestId, p_reverse_id: null, p_code: null, p_valid_until: null, p_error: reason }).catch(() => null);
    return { status: 'escalado', reason: CENTRAL_PENDING_TEXT };
  }

  const sent = await invoke('correios-reverse', {
    action: 'create', idempotency_key: prep.idempotency_key, customer: prep.customer,
    service_code: prep.service_code, return_items: prep.return_items, reason: prep.reason, sale_id: prep.sale_id,
  });
  const item = sent.data?.item;
  const code = item?.codigo_objeto || null;
  const validUntil = item?.valid_until || null;
  const providerError = sent.error || sent.data?.error || item?.error_message || null;
  if (code && validUntil && !providerError) {
    const message = centralReverseMessage(requestType, code, validUntil);
    const done = await rpc(db, 'central_reverse_finish', {
      p_request_id: requestId, p_reverse_id: item.id, p_code: code, p_valid_until: validUntil, p_error: null, p_message: message,
    });
    return { ...done, reverse_code: code, reverse_valid_until: validUntil };
  }

  // Um registro já existente sem código pode ser a outra chamada simultânea ainda processando.
  // Nunca emite outra nota nem outra pré-postagem: a equipe retoma a mesma reversa.
  const reason = String(providerError || 'Os Correios não retornaram o código de postagem').slice(0, 800);
  await rpc(db, 'central_reverse_finish', {
    p_request_id: requestId, p_reverse_id: item?.id || null, p_code: null, p_valid_until: null, p_error: reason,
  }).catch(() => null);
  return { status: 'escalado', reason: CENTRAL_PENDING_TEXT };
}
