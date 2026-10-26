import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { parseBrl, tokenNeedsRenewal, standardCarrier, type FreightPackage, type FreightOption } from './freight-domain.ts';
export { parseBrl } from './freight-domain.ts';
export const DEFAULT_SENDER = { nome: 'Banana Calçados Pérola', nome_etiqueta: 'Banana Calçados', cnpj: '26586173000127', telefone: '33991230581', email: '', cep: '35051520', logradouro: 'Rua Vale Formoso', numero: '362', complemento: '', bairro: 'Kennedy', cidade: 'Governador Valadares', uf: 'MG' };
export const DEFAULT_SERVICES = [{ codigo: '03220', nome: 'SEDEX', ativo: true }, { codigo: '03298', nome: 'PAC', ativo: true }];
export interface CorreiosSettings { id: number; usuario: string; codigo_acesso: string; cartao_postagem: string; contrato: string | null; ambiente: 'producao' | 'homologacao'; enabled: boolean; remetente: typeof DEFAULT_SENDER; servicos: typeof DEFAULT_SERVICES; token: string | null; token_expira_em: string | null; token_meta: Record<string, unknown> | null; updated_at?: string }
export async function loadCorreiosSettings(db: SupabaseClient): Promise<CorreiosSettings> {
  const { data, error } = await db.from('correios_settings').select('id,usuario,codigo_acesso,cartao_postagem,contrato,ambiente,enabled,remetente,servicos,token,token_expira_em,token_meta,updated_at').eq('id', 1).maybeSingle();
  if (error) throw new Error('Não foi possível ler a configuração Correios');
  return data || { id: 1, usuario: '', codigo_acesso: '', cartao_postagem: '', contrato: null, ambiente: 'producao', enabled: false, remetente: DEFAULT_SENDER, servicos: DEFAULT_SERVICES, token: null, token_expira_em: null, token_meta: null };
}
const base = (s: CorreiosSettings) => s.ambiente === 'homologacao' ? 'https://apihom.correios.com.br' : 'https://api.correios.com.br';
function apiError(status: number, data: any) {
  if (status === 401 || status === 403) return 'Correios: credenciais inválidas ou API não liberada no cartão';
  const msg = Array.isArray(data?.msgs) ? data.msgs.map((m: any) => typeof m === 'string' ? m : m.txMsg || m.mensagem || '').filter(Boolean).join('; ') : data?.txMsg;
  return `Correios: ${msg || `não foi possível consultar a API (${status})`}`;
}
async function request(url: string, init: RequestInit) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    if (response.ok && /application\/(pdf|octet-stream)/i.test(response.headers.get('content-type') || '')) return { pdfBytes: new Uint8Array(await response.arrayBuffer()) };
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiError(response.status, data));
    if (data == null) throw new Error('Correios: resposta inválida da API');
    return data;
  } catch (e) {
    if (e instanceof Error && /timeout|abort/i.test(e.name)) throw new Error('Correios: consulta excedeu 15 segundos; tente novamente');
    throw e;
  }
}
export async function getCorreiosToken(db: SupabaseClient, { force = false, settings }: { force?: boolean; settings?: CorreiosSettings } = {}) {
  const s = settings || await loadCorreiosSettings(db);
  if (!force && s.token && !tokenNeedsRenewal(s.token_expira_em)) return { settings: s, token: s.token };
  if (!s.usuario || !s.codigo_acesso || !s.cartao_postagem) throw new Error('Correios: configure usuário, código de acesso à API e cartão de postagem no Admin');
  const encoded = btoa(Array.from(new TextEncoder().encode(`${s.usuario}:${s.codigo_acesso}`), (n) => String.fromCharCode(n)).join(''));
  const data = await request(`${base(s)}/token/v1/autentica/cartaopostagem`, { method: 'POST', headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ numero: s.cartao_postagem }) });
  // CWS timestamps can be local strings without offset; interpret those in Brasília.
  const expiryRaw = String(data.expiraEm || '');
  const expiry = /Z$|[+-]\d\d:\d\d$/.test(expiryRaw) ? expiryRaw : `${expiryRaw}-03:00`;
  if (typeof data.token !== 'string' || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now()) throw new Error('Correios: token ou validade inválidos');
  const meta = { ambiente: data.ambiente, cnpj: data.cnpj, contrato: data.cartaoPostagem?.contrato, dr: data.cartaoPostagem?.dr, apis: [...(Array.isArray(data.api) ? data.api : []), ...(Array.isArray(data.cartaoPostagem?.api) ? data.cartaoPostagem.api : [])] };
  let q = db.from('correios_settings').update({ token: data.token, token_expira_em: expiry, token_meta: meta }).eq('id', 1).eq('usuario', s.usuario).eq('codigo_acesso', s.codigo_acesso).eq('cartao_postagem', s.cartao_postagem).eq('ambiente', s.ambiente);
  if (s.updated_at) q = q.eq('updated_at', s.updated_at);
  const { data: saved, error } = await q.select('id');
  if (error || !saved?.length) throw new Error('Configuração Correios mudou. Salve e teste novamente');
  return { token: data.token, settings: { ...s, token: data.token, token_expira_em: expiry, token_meta: meta } };
}
export function createCorreiosFetch(settings: CorreiosSettings, token: string) {
  return async function correiosFetch(path: string, init: RequestInit) {
    if (!path.startsWith('/')) throw new Error('Caminho Correios inválido');
    return request(`${base(settings)}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' } });
  };
}
export async function quoteCorreios(db: SupabaseClient, settings: CorreiosSettings, p: FreightPackage, destination: string, force = false, allServices = false) {
  const auth = await getCorreiosToken(db, { force, settings });
  const correiosFetch = createCorreiosFetch(auth.settings, auth.token);
  const services = (allServices ? DEFAULT_SERVICES : settings.servicos.filter((s) => s.ativo)).slice(0, 5);
  if (!services.length) return { options: [] as FreightOption[], meta: auth.settings.token_meta, expiraEm: auth.settings.token_expira_em, error: 'Correios: nenhum serviço ativo' };
  const common = (s: typeof DEFAULT_SERVICES[number], i: number) => ({ coProduto: s.codigo, nuRequisicao: String(i + 1), cepOrigem: settings.remetente.cep.replace(/\D/g, ''), cepDestino: destination });
  const results = await Promise.allSettled([
    correiosFetch('/preco/v1/nacional', { method: 'POST', body: JSON.stringify({ idLote: '1', parametrosProduto: services.map((s, i) => ({ ...common(s, i), psObjeto: String(p.peso_g), tpObjeto: '2', comprimento: String(p.c), largura: String(p.l), altura: String(p.a), vlDeclarado: '0' })) }) }),
    correiosFetch('/prazo/v1/nacional', { method: 'POST', body: JSON.stringify({ idLote: '1', parametrosPrazo: services.map(common) }) }),
  ]);
  const messages: string[] = [];
  const prices = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
  const days = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : [];
  results.forEach((r, i) => { if (r.status === 'rejected') messages.push(r.reason instanceof Error ? r.reason.message : 'Correios: consulta falhou'); else if (!Array.isArray(r.value)) messages.push(`Correios: resposta ${i === 0 ? 'de preço' : 'de prazo'} inválida`); });
  const options: FreightOption[] = [];
  for (const s of services) {
    const price = prices.find((r: any) => r.coProduto === s.codigo), prazo = days.find((r: any) => r.coProduto === s.codigo);
    const amount = parseBrl(price?.pcFinal);
    if (!Number.isFinite(amount) || amount <= 0 || price?.txMsg || price?.msgs?.length) { messages.push(apiError(400, price || { txMsg: `Preço ${s.nome} indisponível` })); continue; }
    const rawDays = Number(prazo?.prazoEntrega);
    const validDays = prazo?.prazoEntrega != null && Number.isFinite(rawDays) && rawDays >= 0 && !prazo?.txMsg && !prazo?.msgs?.length;
    if (!validDays) messages.push(apiError(400, prazo || { txMsg: `Prazo ${s.nome} indisponível` }));
    options.push({ source: 'correios', carrier: 'Correios', service: s.nome, service_code: s.codigo, price: amount, delivery_days: validDays ? rawDays : null, note: validDays ? '' : 'Prazo não informado', ...standardCarrier('Correios', s.nome) });
  }
  return { options, meta: auth.settings.token_meta, expiraEm: auth.settings.token_expira_em, error: [...new Set(messages)].join('; ') || undefined };
}