// Pure helpers for Correios pre-posting (schema: prepostagem v3 RequestPrePostagemExternaDTO).
export interface NfeSummary { chave: string; numero: string; serie: string; emissao: string; protocolo: string; emitNome: string; emitCnpj: string; emitIe: string; emitCidade: string; emitUf: string; destNome: string; destDoc: string; destEndereco: string; valorTotal: number; itens: { descricao: string; qtd: number; valor: number }[] }
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
function tagBlock(xml: string, tag: string) { const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`)); return m ? m[1] : ''; }
function tagAll(xml: string, tag: string) { return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g'))].map((m) => m[1]); }
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
const val = (xml: string, tag: string) => decode(tagBlock(xml, tag));
export function parseNfeXml(xml: string, fallback: { chave?: string | null; numero?: unknown; serie?: unknown; protocolo?: string | null } = {}): NfeSummary {
  const ide = tagBlock(xml, 'ide'), emit = tagBlock(xml, 'emit'), dest = tagBlock(xml, 'dest');
  const ee = tagBlock(emit, 'enderEmit'), ed = tagBlock(dest, 'enderDest');
  const idAttr = xml.match(/Id="NFe(\d{44})"/)?.[1];
  const chave = digits(val(xml, 'chNFe') || idAttr || fallback.chave);
  const itens = tagAll(xml, 'det').map((d) => { const p = tagBlock(d, 'prod'); return { descricao: val(p, 'xProd'), qtd: Number(val(p, 'qCom')) || 0, valor: Number(val(p, 'vUnCom')) || 0 }; });
  const endereco = [val(ed, 'xLgr'), val(ed, 'nro'), val(ed, 'xCpl'), val(ed, 'xBairro'), `${val(ed, 'xMun')}/${val(ed, 'UF')}`, val(ed, 'CEP')].filter(Boolean).join(', ');
  return { chave, numero: val(ide, 'nNF') || String(fallback.numero ?? ''), serie: val(ide, 'serie') || String(fallback.serie ?? ''), emissao: val(ide, 'dhEmi') || val(ide, 'dEmi'), protocolo: val(tagBlock(xml, 'infProt'), 'nProt') || String(fallback.protocolo ?? ''), emitNome: val(emit, 'xNome'), emitCnpj: val(emit, 'CNPJ'), emitIe: val(emit, 'IE'), emitCidade: val(ee, 'xMun'), emitUf: val(ee, 'UF'), destNome: val(dest, 'xNome'), destDoc: val(dest, 'CPF') || val(dest, 'CNPJ'), destEndereco: endereco, valorTotal: Number(val(tagBlock(xml, 'ICMSTot'), 'vNF')) || 0, itens };
}
export const groupChave = (c: string) => digits(c).replace(/(\d{4})(?=\d)/g, '$1 ');
export function maskCpf(doc: string) { const d = digits(doc); return d.length === 11 ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : d.length === 14 ? `${d.slice(0, 2)}.***.***/****-${d.slice(12)}` : ''; }
// Code 128 bar/space widths for values 0..106 (106 = stop).
export const CODE128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
/** Code 128 subset C module widths (alternating bar/space, starting with bar). */
export function code128C(data: string): number[] {
  if (!/^\d+$/.test(data) || data.length % 2) throw new Error('Code 128C exige quantidade par de dígitos');
  const values = [105];
  for (let i = 0; i < data.length; i += 2) values.push(Number(data.slice(i, i + 2)));
  const check = values.reduce((sum, v, i) => sum + v * (i || 1), 0) % 103;
  return [...values, check, 106].flatMap((v) => CODE128[v].split('').map(Number));
}
export interface ShipmentSale { id: string; customer_name?: string | null; customer_cpf?: string | null; customer_phone?: string | null; customer_email?: string | null; shipping_address?: Record<string, any> | null; is_store_pickup?: boolean | null; status?: string | null; status_cancelamento?: string | null }
export interface Sender { nome: string; cnpj: string; telefone: string; email?: string; cep: string; logradouro: string; numero: string; complemento?: string; bairro: string; cidade: string; uf: string }
export function saleAddress(sale: ShipmentSale) {
  const a = sale.shipping_address || {};
  return { cep: digits(a.zip_code || a.zip || a.cep || a.postal_code), logradouro: clip(a.address || a.street || a.logradouro, 50), numero: clip(a.number || a.numero, 6), complemento: clip(a.complement || a.complemento, 30), bairro: clip(a.neighborhood || a.bairro || a.district, 30), cidade: clip(a.city || a.cidade, 30), uf: clip(a.state || a.uf, 2).toUpperCase() };
}
export function addressProblems(sale: ShipmentSale) {
  const a = saleAddress(sale), missing: string[] = [];
  if (!/^\d{8}$/.test(a.cep)) missing.push('CEP');
  if (!a.logradouro) missing.push('logradouro'); if (!a.numero) missing.push('número'); if (!a.bairro) missing.push('bairro'); if (!a.cidade) missing.push('cidade'); if (!/^[A-Z]{2}$/.test(a.uf)) missing.push('UF');
  return missing;
}
function phoneParts(raw: unknown) {
  let d = digits(raw); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return { dddCelular: d.slice(0, 2), celular: d.slice(2) };
  if (d.length === 10) return { dddTelefone: d.slice(0, 2), telefone: d.slice(2) };
  return {};
}
const validEmail = (e: unknown) => typeof e === 'string' && /^[^\s@.][^\s@]*@[^\s@]+\.[a-z]{2,}$/i.test(e.trim()) && !/\.\.|\.@/.test(e) ? e.trim().slice(0, 255) : undefined;
export function buildPrePostagemPayload(input: { sender: Sender; sale: ShipmentSale; serviceCode: string; pkg: { peso_g: number; c: number; l: number; a: number }; nfes: NfeSummary[]; reference: string }) {
  const { sender, sale, serviceCode, pkg, nfes } = input;
  const problems: string[] = [];
  const senderName = clip(sender.nome, 50);
  if (senderName.length < 3) problems.push('Nome do remetente deve ter 3 a 50 caracteres');
  const dest = saleAddress(sale);
  const missing = addressProblems(sale); if (missing.length) problems.push(`Endereço incompleto: ${missing.join(', ')}`);
  const destName = clip(sale.customer_name, 50); if (destName.split(' ').filter(Boolean).length < 2) problems.push('Nome do destinatário precisa de nome e sobrenome');
  if (!/^\d{5}$/.test(serviceCode)) problems.push('Serviço Correios inválido');
  if (!(pkg.peso_g > 0 && pkg.peso_g <= 999999)) problems.push('Peso inválido');
  if (!nfes.length) problems.push('NF-e autorizada obrigatória');
  const main = nfes[0];
  if (main && !/^\d{44}$/.test(main.chave)) problems.push('Chave da NF-e inválida');
  const cpf = digits(sale.customer_cpf);
  const others = nfes.slice(1).map((n) => n.numero).filter(Boolean);
  const items = nfes.flatMap((n) => n.itens).filter((i) => i.qtd > 0);
  const payload = {
    remetente: { nome: senderName, cpfCnpj: digits(sender.cnpj), ...phoneParts(sender.telefone), ...(validEmail(sender.email) ? { email: validEmail(sender.email) } : {}), endereco: { cep: digits(sender.cep), logradouro: clip(sender.logradouro, 50), numero: clip(sender.numero, 6), ...(sender.complemento ? { complemento: clip(sender.complemento, 30) } : {}), bairro: clip(sender.bairro, 30), cidade: clip(sender.cidade, 30), uf: clip(sender.uf, 2).toUpperCase() } },
    destinatario: { nome: destName, ...(cpf.length === 11 || cpf.length === 14 ? { cpfCnpj: cpf } : {}), ...phoneParts(sale.customer_phone), ...(validEmail(sale.customer_email) ? { email: validEmail(sale.customer_email) } : {}), endereco: { cep: dest.cep, logradouro: dest.logradouro, numero: dest.numero, ...(dest.complemento ? { complemento: dest.complemento } : {}), bairro: dest.bairro, cidade: dest.cidade, uf: dest.uf, regiao: dest.uf } },
    codigoServico: serviceCode,
    ...(main ? { numeroNotaFiscal: digits(main.numero).slice(0, 12), chaveNFe: main.chave } : {}),
    itensDeclaracaoConteudo: (items.length ? items : [{ descricao: 'Calcados', qtd: 1, valor: 0 }]).slice(0, 50).map((i) => ({ conteudo: clip(i.descricao || 'Calcados', 60).padEnd(2, '.'), quantidade: String(Math.round(i.qtd)), valor: i.valor.toFixed(2) })),
    pesoInformado: String(Math.ceil(pkg.peso_g)),
    codigoFormatoObjetoInformado: '2',
    alturaInformada: String(Math.ceil(pkg.a)), larguraInformada: String(Math.ceil(pkg.l)), comprimentoInformado: String(Math.ceil(pkg.c)),
    cienteObjetoNaoProibido: '1',
    solicitarColeta: 'N', emiteDCe: 'N',
    observacao: clip(others.length ? `Tambem NF-e ${others.join(',')}` : `Pedido ${input.reference}`, 50),
    pedidoExternoOrigem: clip(input.reference, 50),
  };
  return { payload, problems };
}
export const correiosTrackingUrl = (code: string) => `https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(code)}`;
/** Accepts PDF as raw bytes, base64 string or JSON wrapper used by CWS async download. */
export function extractPdfBase64(data: any): string | null {
  if (!data) return null;
  if (typeof data === 'string') { const s = data.replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, ''); return s.startsWith('JVBER') ? s : null; }
  for (const k of ['dados', 'pdf', 'arquivo', 'rotulo', 'conteudo', 'base64']) { const r = extractPdfBase64(data[k]); if (r) return r; }
  return null;
}
