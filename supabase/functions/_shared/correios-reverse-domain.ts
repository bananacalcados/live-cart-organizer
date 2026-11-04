// Pure helpers for Correios reverse logistics (customer -> store, paid by our contract).
import { schemaProblems, type Sender } from './correios-prepost-domain.ts';

export const REVERSE_SERVICES = [
  { codigo: '03301', nome: 'PAC Reverso' },
  { codigo: '03247', nome: 'SEDEX Reverso' },
];
export const REVERSE_DEFAULT_PACKAGE = { peso_g: 1000, c: 33, l: 22, a: 13 };
/** Prazo de postagem que damos à cliente: 7 dias corridos. */
export const REVERSE_VALID_DAYS = 7;

export interface ReverseCustomer { nome: string; cpf?: string | null; telefone: string; email?: string | null; cep: string; logradouro: string; numero: string; complemento?: string | null; bairro: string; cidade: string; uf: string }

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
function phoneParts(raw: unknown) {
  let d = digits(raw); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return { dddCelular: d.slice(0, 2), celular: d.slice(2) };
  if (d.length === 10) return { dddTelefone: d.slice(0, 2), telefone: d.slice(2) };
  return {};
}
export function validCpf(c: string) {
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
/** dd/MM/yyyy in São Paulo, `days` after `now`. */
export function reverseValidity(now: Date, days = REVERSE_VALID_DAYS) {
  const d = new Date(now.getTime() + days * 86400000);
  const [y, m, dd] = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-');
  return { br: `${dd}/${m}/${y}`, iso: `${y}-${m}-${dd}` };
}

/** Reverse: the CUSTOMER is the sender (remetente) and the store is the recipient. */
export function buildReversePayload(input: { customer: ReverseCustomer; store: Sender; serviceCode: string; pkg: { peso_g: number; c: number; l: number; a: number }; items: { conteudo: string; quantidade: number; valor: number }[]; validUntilBr: string; reference: string }) {
  const { customer: c, store: s, pkg } = input;
  const problems: string[] = [];
  if (!REVERSE_SERVICES.some((x) => x.codigo === input.serviceCode)) problems.push('Serviço de reversa inválido');
  const name = clip(c.nome, 50);
  if (name.split(' ').filter(Boolean).length < 2) problems.push('Nome da cliente precisa de nome e sobrenome');
  const cpf = digits(c.cpf);
  if (cpf && !validCpf(cpf)) problems.push('CPF da cliente inválido');
  if (!phoneParts(c.telefone).dddCelular && !phoneParts(c.telefone).dddTelefone) problems.push('Telefone da cliente inválido');
  const items = input.items.filter((i) => i.quantidade > 0 && clip(i.conteudo, 60).length >= 2);
  const payload = {
    remetente: { nome: name, ...(cpf ? { cpfCnpj: cpf } : {}), ...phoneParts(c.telefone), ...(c.email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c.email.trim()) ? { email: c.email.trim().slice(0, 255) } : {}),
      endereco: { cep: digits(c.cep), logradouro: clip(c.logradouro, 50), numero: clip(c.numero, 6) || 'SN', ...(c.complemento ? { complemento: clip(c.complemento, 30) } : {}), bairro: clip(c.bairro, 30), cidade: clip(c.cidade, 30), uf: clip(c.uf, 2).toUpperCase() } },
    destinatario: { nome: clip(s.nome, 50), cpfCnpj: digits(s.cnpj).slice(0, 14), ...phoneParts(s.telefone),
      endereco: { cep: digits(s.cep), logradouro: clip(s.logradouro, 50), numero: clip(s.numero, 6), ...(s.complemento ? { complemento: clip(s.complemento, 30) } : {}), bairro: clip(s.bairro, 30), cidade: clip(s.cidade, 30), uf: clip(s.uf, 2).toUpperCase() } },
    codigoServico: input.serviceCode,
    itensDeclaracaoConteudo: (items.length ? items : [{ conteudo: 'Calcados', quantidade: 1, valor: 0 }]).slice(0, 50).map((i) => ({ conteudo: clip(i.conteudo, 60), quantidade: String(Math.round(i.quantidade)), valor: Math.max(0, Number(i.valor) || 0).toFixed(2) })),
    pesoInformado: String(Math.ceil(pkg.peso_g)),
    codigoFormatoObjetoInformado: '2',
    alturaInformada: String(Math.ceil(pkg.a)), larguraInformada: String(Math.ceil(pkg.l)), comprimentoInformado: String(Math.ceil(pkg.c)),
    cienteObjetoNaoProibido: '1',
    solicitarColeta: 'N', emiteDCe: 'N',
    logisticaReversa: 'S', dataValidadeLogReversa: input.validUntilBr,
    observacao: clip(`Reversa ${input.reference}`, 50),
    pedidoExternoOrigem: clip(input.reference, 25),
  };
  problems.push(...schemaProblems(payload));
  return { payload, problems };
}

export function reverseMessage(opts: { firstName: string; code: string; service: string; validUntilBr: string }) {
  const hi = opts.firstName ? `Oi, ${opts.firstName}!` : 'Oi!';
  return `${hi} Sua etiqueta de devolução pelos Correios está pronta 📦\n\nCódigo de postagem: *${opts.code}*\nServiço: ${opts.service}\nVálido até: ${opts.validUntilBr}\n\n⚠️ Atenção: esse código só vale até essa data. Se não postar até lá, é preciso pedir uma nova etiqueta.\n\nÉ só levar o pacote bem fechado a qualquer agência dos Correios e informar esse código. Você não paga nada pelo envio.`;
}
