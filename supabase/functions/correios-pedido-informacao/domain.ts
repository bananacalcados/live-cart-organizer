// Correios API manual V2.4 (04/2025), pp. 64–77: national information requests.
export const MOTIVOS: Record<number, string> = {
  211: 'Objeto não entregue', 135: 'Entregue com atraso', 132: 'Entregue em local divergente',
  133: 'Objeto violado', 134: 'Objeto avariado', 136: 'Devolvido indevidamente',
};
export type PiStatus = 'aberto' | 'respondido' | 'reativado' | 'encerrado' | 'erro';
export type RecordData = Record<string, unknown>;
export const object = (v: unknown): RecordData => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordData : {};
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
function field(v: unknown, ...keys: string[]): unknown {
  const row = object(v);
  for (const key of keys) for (const [k, val] of Object.entries(row)) if (norm(k) === norm(key)) return val;
}
const text = (v: unknown) => v == null ? '' : String(v).trim();
export function brazilDate(v: unknown): string | null {
  const raw = text(v), m = /^(\d{2})\/(\d{2})\/(\d{4})\s*(?:-\s*)?(\d{2}):(\d{2}):(\d{2})\s*$/.exec(raw);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00`;
  return Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
}
export function buildOpenPayload(input: {
  contrato: string; cartao: string; telefone: string; email: string;
  codigoObjeto: string; nome: string; motivo: number; tipo: 'R' | 'I'; formato: string;
}) {
  if (!/^\d+$/.test(input.contrato) || !/^\d+$/.test(input.cartao)) throw new Error('Correios: configure contrato e cartão de postagem');
  const telefone = input.telefone.replace(/\D/g, '');
  if (!/^\d{10,13}$/.test(telefone)) throw new Error('Correios: configure o telefone do remetente');
  if (!/^[A-Z]{2}\d{9}BR$/.test(input.codigoObjeto) || !input.nome.trim() || !MOTIVOS[input.motivo]) throw new Error('Dados do objeto, destinatário ou motivo inválidos');
  if (!['1', '2'].includes(input.formato)) throw new Error('Correios: embalagem do envio não identificada (envelope ou caixa)');
  // NÃO REMOVER: contato é do remetente configurado; nunca da cliente ou de um dono presumido.
  const payload = { contrato: input.contrato, cartao: input.cartao, telefone, pedidos: [{
    codigoObjeto: input.codigoObjeto, emailResposta: input.email.trim(), nomeDestinatario: input.nome.trim(),
    codigoMotivoReclamacao: input.motivo, tipoEmbalagem: input.formato === '2' ? 'C' : 'E', tipoManifestacao: input.tipo,
  }] };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || /\.\.|^\.|\.@/.test(input.email)) throw Object.assign(new Error('Correios: configure o e-mail do remetente nas configurações dos Correios antes de abrir o chamado'), { payload });
  return payload;
}
export function buildReactivatePayload(contrato: string, cartao: string, row: {protocolo: string; tipo_manifestacao: 'R' | 'I'; motivo_codigo: number}, texto: string) {
  if (!row.protocolo || !texto.trim() || !MOTIVOS[row.motivo_codigo]) throw new Error('Protocolo, motivo e texto da reativação são obrigatórios');
  return { contrato, cartao, reativacoes: [{ protocolo: row.protocolo, tipoManifestacao: row.tipo_manifestacao, motivoReativacao: String(row.motivo_codigo), observacao: texto.trim() }] };
}
export function trackingQuery(contrato: string, identifier: string): string {
  return `/pedido-informacao/v1/externo/pedidos/acompanha?${new URLSearchParams({ contrato, canal: 'W', codigodoObjetoOuProtocolo: identifier })}`;
}
export function providerMessage(data: unknown): string {
  const direct = text(field(data, 'descricaoRetorno', 'descrição retorno', 'mensagem', 'message', 'txMsg'));
  if (direct) return direct;
  const msgs = field(data, 'msgs', 'mensagens');
  if (Array.isArray(msgs)) return msgs.map(m => typeof m === 'string' ? m : providerMessage(m)).filter(Boolean).join('; ');
  return '';
}
export function parseOpen(data: unknown, codigo: string) {
  const pis = field(data, 'pi');
  const candidates = Array.isArray(pis) ? pis.filter(p => text(field(p, 'codigo do objeto', 'codigoObjeto')) === codigo) : [];
  const item = candidates.length === 1 ? candidates[0] : null;
  const code = text(field(item, 'codigo retorno', 'codigoRetorno') ?? field(data, 'codigoRetorno'));
  const protocolo = text(field(item, 'numero do pi', 'numeroPi', 'protocolo'));
  return { ok: !!item && /^0+$/.test(code) && /^\d+$/.test(protocolo) && Number(protocolo) > 0,
    protocolo: protocolo || null, message: providerMessage(item) || providerMessage(data), code,
    opened_at: brazilDate(field(data, 'dataHoraCadastro')) };
}
export function parseReactivate(data: unknown, protocolo: string) {
  const pis = field(data, 'listaPi', 'pi');
  const candidates = Array.isArray(pis) ? pis.filter(p => ['0', protocolo].includes(text(field(p, 'protocolo')))) : [];
  const item = candidates.length === 1 ? candidates[0] : null;
  return { ok: !!item && text(field(item, 'codigoRetorno')) === '512', message: providerMessage(item) || providerMessage(data) };
}
export function parseCheck(data: unknown, codigo: string, protocolo: string | null, current: PiStatus) {
  const actualCode = text(field(data, 'codigoObjeto')), actualPi = text(field(data, 'numeroPi'));
  if (actualCode !== codigo || !actualPi || (protocolo && actualPi !== protocolo)) return { ok: false as const, message: providerMessage(data) || 'Correios: resposta sem identificação exata do chamado' };
  const situation = norm(text(field(data, 'situacaoManifestacao'))), resposta = text(field(data, 'mensagemUltimaResposta'));
  const reactivationPending = current === 'reativado' && /abert|andamento|tratamento/.test(situation);
  const status: PiStatus = /fechad|encerrad/.test(situation) ? 'encerrado' : reactivationPending ? 'reativado' : resposta ? 'respondido' : current;
  return { ok: true as const, status, protocolo: actualPi, resposta_texto: resposta || null, answered_at: brazilDate(field(data, 'dataUltimaResposta')), message: '' };
}
export function safePayload(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(safePayload);
  if (data && typeof data === 'object') return Object.fromEntries(Object.entries(object(data)).filter(([k]) => !/token|authorization|senha|password|secret|codigoacesso/i.test(norm(k))).map(([k,v]) => [k,safePayload(v)]));
  return data;
}