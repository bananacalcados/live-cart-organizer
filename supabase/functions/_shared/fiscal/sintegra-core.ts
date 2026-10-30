// Módulo COMPARTILHADO (navegador + edge functions). Sem APIs de navegador/Deno.
// Gerador de arquivo Sintegra (Convênio ICMS 57/95).
// Monta registros de largura fixa a partir de dados já coletados/parseados.
//
// IMPORTANTE: layout nacional 57/95. O arquivo gerado deve ser validado no
// validador Sintegra da SEFAZ do estado e conferido pela contabilidade antes
// de valer para o fisco. Este gerador cobre os registros 10, 11, 50, 54, 60
// (M/A), 75 e 90.

// ---------- Helpers de formatação de campo ----------

/** Campo alfanumérico: alinha à esquerda, corta/preenche com espaços. */
export function alpha(value: string | null | undefined, len: number): string {
  const s = (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^\x20-\x7E]/g, " ") // só ASCII imprimível
    .toUpperCase();
  return s.slice(0, len).padEnd(len, " ");
}

/** Campo numérico inteiro: alinha à direita com zeros. */
export function num(value: number | string | null | undefined, len: number): string {
  const digits = (value ?? "").toString().replace(/\D/g, "");
  return digits.slice(-len).padStart(len, "0");
}

/** Campo de valor: N casas decimais, sem separador, zero-pad à esquerda. */
export function money(value: number | null | undefined, len: number, decimals = 2): string {
  const v = Math.round((Number(value) || 0) * Math.pow(10, decimals));
  const digits = Math.abs(v).toString();
  return digits.slice(-len).padStart(len, "0");
}

/** Data AAAAMMDD a partir de Date ou ISO string. */
export function ymd(d: Date | string | null | undefined): string {
  if (!d) return "00000000";
  // Data civil no fuso de São Paulo (UTC-3, sem horário de verão desde 2019),
  // igual no navegador e no servidor. "AAAA-MM-DD" puro é tratado como data civil.
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d.replace(/-/g, "");
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "00000000";
  const sp = new Date(date.getTime() - 3 * 3600 * 1000);
  const y = sp.getUTCFullYear().toString().padStart(4, "0");
  const m = (sp.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = sp.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}

// ---------- Tipos de entrada ----------

export interface SintegraCompany {
  cnpj: string;
  ie: string;
  ie_isento?: boolean;
  legal_name: string;
  city: string;
  uf: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  cep: string;
  contact_name: string;
  contact_phone: string;
}

export interface SintegraNote {
  // cabeçalho comum (reg 50)
  cnpj_contraparte: string; // CNPJ/CPF do destinatário (saída) ou remetente (entrada)
  ie_contraparte?: string;
  uf_contraparte?: string;
  data: string | Date;
  modelo: number; // 55
  serie: string | number;
  numero: number | string;
  cfop?: string;
  emitente: "P" | "T"; // P = próprio (saída), T = terceiros (entrada)
  valor_total: number;
  base_icms?: number;
  valor_icms?: number;
  valor_isento?: number;
  outras?: number;
  aliquota?: number;
  situacao?: "N" | "S"; // N normal, S cancelada
  itens?: SintegraItem[];
}

export interface SintegraItem {
  cnpj_contraparte: string;
  modelo: number;
  serie: string | number;
  numero: number | string;
  cfop?: string;
  cst?: string;
  ordem: number;
  codigo: string;
  descricao?: string;
  ncm?: string;
  unidade?: string;
  quantidade: number;
  valor_bruto: number;
  desconto?: number;
  base_icms?: number;
  base_icms_st?: number;
  valor_ipi?: number;
  aliquota_icms?: number;
}

/** Resumo diário de NFC-e (modelo 65) para registro 60. */
export interface SintegraNfceDay {
  data: string; // AAAAMMDD ou ISO
  serie: string | number;
  primeiro_numero: number;
  ultimo_numero: number;
  qtde: number;
  valor_bruto: number;
  aliquotas?: { aliquota: number; valor: number }[];
}

export interface SintegraInput {
  company: SintegraCompany;
  periodStart: Date;
  periodEnd: Date;
  natureza: "1" | "2" | "3"; // 1 entradas, 2 saídas, 3 ambas
  finalidade: "1" | "2" | "3"; // 1 normal, 2 retif total, 3 retif aditiva
  notes: SintegraNote[]; // NF-e modelo 55 (saídas e entradas)
  nfceDays: SintegraNfceDay[]; // resumo NFC-e modelo 65
  products?: SintegraProduct[]; // registro 75
}

export interface SintegraProduct {
  codigo: string;
  descricao?: string;
  ncm?: string;
  unidade?: string;
  aliquota_icms?: number;
}

export interface SintegraResult {
  content: string;
  stats: Record<string, number>;
  warnings: string[];
}

// ---------- Construtores de registro ----------

function rec10(c: SintegraCompany, start: Date, end: Date, natureza: string, finalidade: string): string {
  return (
    "10" +
    num(c.cnpj, 14) +
    alpha(c.ie_isento ? "ISENTO" : c.ie, 14) +
    alpha(c.legal_name, 35) +
    alpha(c.city, 30) +
    alpha(c.uf, 2) +
    num("", 10) + // fax
    ymd(start) +
    ymd(end) +
    "3" + // estrutura do arquivo (layout atual)
    natureza +
    finalidade
  );
}

function rec11(c: SintegraCompany): string {
  return (
    "11" +
    alpha(c.street, 34) +
    num(c.number, 5) +
    alpha(c.complement, 22) +
    alpha(c.neighborhood, 15) +
    num(c.cep, 8) +
    alpha(c.contact_name, 28) +
    num(c.contact_phone, 12)
  );
}

function rec50(n: SintegraNote): string {
  return (
    "50" +
    num(n.cnpj_contraparte, 14) +
    alpha(n.ie_contraparte || "ISENTO", 14) +
    ymd(n.data) +
    alpha(n.uf_contraparte, 2) +
    num(n.modelo, 2) +
    alpha(String(n.serie ?? ""), 3) +
    num(n.numero, 6) +
    num(n.cfop, 4) +
    alpha(n.emitente, 1) +
    money(n.valor_total, 13) +
    money(n.base_icms, 13) +
    money(n.valor_icms, 13) +
    money(n.valor_isento, 13) +
    money(n.outras, 13) +
    money(n.aliquota, 4) +
    alpha(n.situacao || "N", 1)
  );
}

function rec54(it: SintegraItem): string {
  return (
    "54" +
    num(it.cnpj_contraparte, 14) +
    num(it.modelo, 2) +
    alpha(String(it.serie ?? ""), 3) +
    num(it.numero, 6) +
    num(it.cfop, 4) +
    num(it.cst || "000", 3) +
    num(it.ordem, 3) +
    alpha(it.codigo, 14) +
    money(it.quantidade, 11, 3) +
    money(it.valor_bruto, 12) +
    money(it.desconto, 12) +
    money(it.base_icms, 12) +
    money(it.base_icms_st, 12) +
    money(it.valor_ipi, 12) +
    money(it.aliquota_icms, 4)
  );
}

function rec60M(d: SintegraNfceDay): string {
  return (
    "60" +
    "M" +
    ymd(d.data) +
    alpha(`NFCE-S${d.serie}`, 20) + // "equipamento" (série NFC-e)
    num("1", 3) + // nº ordem equipamento
    num(String(d.ultimo_numero), 6) + // CRZ (usamos último número)
    num(String(d.ultimo_numero), 6) + // COO último documento
    num("0", 2) + // CRO
    money(d.valor_bruto, 16) +
    money(d.valor_bruto, 16) + // GT (acumulado) — aproximado
    alpha("", 46)
  );
}

function rec60A(data: string, aliquota: number, valor: number): string {
  return (
    "60" +
    "A" +
    ymd(data) +
    alpha("NFCE", 20) +
    money(aliquota, 4) +
    money(valor, 12) +
    alpha("", 79)
  );
}

function rec75(start: Date, end: Date, p: SintegraProduct): string {
  return (
    "75" +
    ymd(start) +
    ymd(end) +
    alpha(p.codigo, 14) +
    num(p.ncm, 8) +
    alpha(p.descricao, 53) +
    alpha(p.unidade || "UN", 6) +
    money(0, 5) + // alíquota IPI
    money(p.aliquota_icms, 4) + // alíquota ICMS
    money(0, 5) + // redução BC
    money(0, 13) // BC ICMS ST
  );
}

function rec90(c: SintegraCompany, counts: Record<string, number>, totalLines: number): string {
  const prefix = "90" + num(c.cnpj, 14) + alpha(c.ie_isento ? "ISENTO" : c.ie, 14);
  const pairs: string[] = [];
  for (const tipo of ["50", "54", "60", "75"]) {
    if (counts[tipo]) pairs.push(num(tipo, 2) + num(counts[tipo], 8));
  }
  // par obrigatório 99 = total de registros do arquivo
  pairs.push("99" + num(totalLines, 8));
  const body = prefix + pairs.join("");
  const numReg90 = "1"; // número de registros tipo 90
  // completa até 125 e coloca contador na posição 126
  return body.slice(0, 125).padEnd(125, " ") + numReg90;
}

// ---------- Montagem principal ----------

export function buildSintegra(input: SintegraInput): SintegraResult {
  const warnings: string[] = [];
  const { company, periodStart, periodEnd } = input;

  // Validação de campos obrigatórios da empresa
  if (!company.cnpj || company.cnpj.replace(/\D/g, "").length !== 14)
    warnings.push("CNPJ da empresa inválido ou ausente.");
  if (!company.ie_isento && !company.ie) warnings.push("Inscrição Estadual ausente.");
  if (!company.uf) warnings.push("UF da empresa ausente.");
  if (!company.city) warnings.push("Município da empresa ausente.");
  if (!company.cep) warnings.push("CEP da empresa ausente.");

  const lines: string[] = [];
  const counts: Record<string, number> = {};
  const bump = (t: string) => (counts[t] = (counts[t] || 0) + 1);

  // Registro 10 e 11 (não entram na contagem por tipo do 90, mas contam no 99)
  lines.push(rec10(company, periodStart, periodEnd, input.natureza, input.finalidade));
  lines.push(rec11(company));

  // Registros 50 + 54 (NF-e modelo 55)
  for (const n of input.notes) {
    lines.push(rec50(n));
    bump("50");
    for (const it of n.itens || []) {
      lines.push(rec54(it));
      bump("54");
    }
  }

  // Registros 60 (NFC-e modelo 65)
  for (const d of input.nfceDays) {
    lines.push(rec60M(d));
    bump("60");
    const aliqs = d.aliquotas && d.aliquotas.length ? d.aliquotas : [{ aliquota: 0, valor: d.valor_bruto }];
    for (const a of aliqs) {
      lines.push(rec60A(d.data, a.aliquota, a.valor));
      bump("60");
    }
  }

  // Registro 75 (cadastro de produtos)
  for (const p of input.products || []) {
    lines.push(rec75(periodStart, periodEnd, p));
    bump("75");
  }

  // Registro 90 (totalização). totalLines inclui o próprio 90.
  const totalLines = lines.length + 1;
  lines.push(rec90(company, counts, totalLines));

  // Sanity: todas as linhas devem ter 126 chars
  const badLen = lines.filter((l) => l.length !== 126).length;
  if (badLen > 0) warnings.push(`${badLen} registro(s) com tamanho diferente de 126 caracteres.`);

  const content = lines.join("\r\n") + "\r\n";

  const stats: Record<string, number> = {
    total_registros: lines.length,
    registros_50: counts["50"] || 0,
    registros_54: counts["54"] || 0,
    registros_60: counts["60"] || 0,
    registros_75: counts["75"] || 0,
  };

  return { content, stats, warnings };
}

// ---------- Montagem a partir das linhas do banco (única versão) ----------

export interface SaleXmlLike {
  base_icms: number; valor_icms: number; cfop_predominante?: string;
  items: { ordem: number; codigo: string; descricao: string; ncm?: string; cfop?: string; cst?: string;
    unidade?: string; quantidade: number; valor_bruto: number; desconto: number; base_icms: number;
    valor_ipi: number; aliquota_icms: number }[];
}

export interface AssembleSintegraArgs {
  company: SintegraCompany;
  periodStart: Date;
  periodEnd: Date;
  natureza: "1" | "2" | "3";
  finalidade: "1" | "2" | "3";
  docs55: any[]; // fiscal_documents modelo 55 autorizadas
  docs65: any[]; // fiscal_documents modelo 65 autorizadas
  entradas: any[]; // purchase_invoices
  entradaItems: any[]; // purchase_invoice_items
  parseXml: (xml: string) => SaleXmlLike | null;
}

/** Data civil AAAA-MM-DD em São Paulo. */
export function spDay(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export function assembleSintegra(a: AssembleSintegraArgs): SintegraResult & { noteCount: number; nfceDayCount: number } {
  const warnings: string[] = [];
  const notes: SintegraNote[] = [];
  const productMap = new Map<string, SintegraProduct>();
  let semXml = 0;

  for (const d of a.docs55 || []) {
    const parsed = d.xml_content ? a.parseXml(d.xml_content) : null;
    if (!parsed) semXml++;
    const itens: SintegraItem[] = (parsed?.items || []).map((it) => {
      if (it.codigo && !productMap.has(it.codigo)) {
        productMap.set(it.codigo, {
          codigo: it.codigo, descricao: it.descricao, ncm: it.ncm,
          unidade: it.unidade, aliquota_icms: it.aliquota_icms,
        });
      }
      return {
        cnpj_contraparte: d.cpf_destinatario || "",
        modelo: 55, serie: d.serie ?? 1, numero: d.numero ?? 0,
        cfop: it.cfop, cst: it.cst, ordem: it.ordem, codigo: it.codigo,
        descricao: it.descricao, ncm: it.ncm, unidade: it.unidade,
        quantidade: it.quantidade, valor_bruto: it.valor_bruto, desconto: it.desconto,
        base_icms: it.base_icms, base_icms_st: 0, valor_ipi: it.valor_ipi,
        aliquota_icms: it.aliquota_icms,
      };
    });
    notes.push({
      cnpj_contraparte: d.cpf_destinatario || "",
      data: d.data_autorizacao!, modelo: 55, serie: d.serie ?? 1, numero: d.numero ?? 0,
      cfop: parsed?.cfop_predominante || "5102", emitente: "P",
      valor_total: Number(d.valor_total) || 0,
      base_icms: parsed?.base_icms || 0, valor_icms: parsed?.valor_icms || 0,
      valor_isento: 0, outras: 0, aliquota: 0, situacao: "N", itens,
    });
  }
  if (semXml > 0) warnings.push(`${semXml} NF-e sem XML salvo — geradas sem detalhe de itens (registro 54).`);

  const dayMap = new Map<string, SintegraNfceDay>();
  for (const d of a.docs65 || []) {
    const day = spDay(d.data_autorizacao);
    const key = `${day}|${d.serie ?? 1}`;
    const cur = dayMap.get(key) || {
      data: day, serie: d.serie ?? 1, primeiro_numero: Number(d.numero) || 0,
      ultimo_numero: Number(d.numero) || 0, qtde: 0, valor_bruto: 0,
    };
    cur.qtde += 1;
    cur.valor_bruto += Number(d.valor_total) || 0;
    cur.primeiro_numero = Math.min(cur.primeiro_numero || Number(d.numero) || 0, Number(d.numero) || 0);
    cur.ultimo_numero = Math.max(cur.ultimo_numero, Number(d.numero) || 0);
    dayMap.set(key, cur);
  }
  const nfceDays = Array.from(dayMap.values());

  const itemsByInvoice = new Map<string, any[]>();
  for (const it of a.entradaItems || []) {
    const arr = itemsByInvoice.get(it.invoice_id) || [];
    arr.push(it);
    itemsByInvoice.set(it.invoice_id, arr);
  }
  for (const e of a.entradas || []) {
    const its = (itemsByInvoice.get(e.id) || []).sort((x, y) => (x.line_number || 0) - (y.line_number || 0));
    const itens: SintegraItem[] = its.map((it, idx) => {
      const code = it.supplier_product_code || String(idx + 1);
      if (code && !productMap.has(code)) {
        productMap.set(code, { codigo: code, descricao: it.description, ncm: it.ncm, unidade: it.unit });
      }
      return {
        cnpj_contraparte: e.supplier_cnpj || "",
        modelo: 55, serie: e.invoice_series ?? 1, numero: e.invoice_number ?? 0,
        cfop: it.cfop, cst: "000", ordem: idx + 1, codigo: code,
        descricao: it.description, ncm: it.ncm, unidade: it.unit,
        quantidade: Number(it.quantity) || 0, valor_bruto: Number(it.total_cost) || 0,
        desconto: 0, base_icms: 0, base_icms_st: 0, valor_ipi: 0, aliquota_icms: 0,
      };
    });
    notes.push({
      cnpj_contraparte: e.supplier_cnpj || "",
      ie_contraparte: e.supplier_ie || undefined,
      data: e.emission_date!, modelo: 55, serie: e.invoice_series ?? 1, numero: e.invoice_number ?? 0,
      cfop: its[0]?.cfop || "1102", emitente: "T", valor_total: Number(e.total_value) || 0,
      base_icms: 0, valor_icms: 0, valor_isento: 0, outras: 0, aliquota: 0, situacao: "N", itens,
    });
  }

  const res = buildSintegra({
    company: a.company, periodStart: a.periodStart, periodEnd: a.periodEnd,
    natureza: a.natureza, finalidade: a.finalidade,
    notes, nfceDays, products: Array.from(productMap.values()),
  });
  res.warnings.unshift(...warnings);
  return { ...res, noteCount: notes.length, nfceDayCount: nfceDays.length };
}

/** Mês fechado em Brasília: dia 1 00:00:00 até o último dia 23:59:59.999 (America/Sao_Paulo, UTC-3). */
export function fiscalMonthBounds(ref: string) {
  const [y, m] = ref.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 3));
  const end = new Date(Date.UTC(y, m, 1, 3) - 1);
  return { start, end, startIso: start.toISOString(), endIso: end.toISOString() };
}
