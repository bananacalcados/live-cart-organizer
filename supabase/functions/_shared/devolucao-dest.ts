// Regras puras da NF-e de devolução (finalidade 4): destinatário e itens vindos do
// XML AUTORIZADO da nota original, mapeamento saída→entrada e pré-checagem antes da SEFAZ.
// Sem rede, sem banco — testado em devolucao-dest.test.ts.

export const UF_IBGE: Record<string, string> = {
  RO:"11",AC:"12",AM:"13",RR:"14",PA:"15",AP:"16",TO:"17",MA:"21",PI:"22",CE:"23",RN:"24",PB:"25",
  PE:"26",AL:"27",SE:"28",BA:"29",MG:"31",ES:"32",RJ:"33",SP:"35",PR:"41",SC:"42",RS:"43",MS:"50",
  MT:"51",GO:"52",DF:"53",
};

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
};
const decode = (s: string | null) => s == null ? null :
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export interface DestAddress {
  xLgr?: string | null; nro?: string | null; xCpl?: string | null; xBairro?: string | null;
  cMun?: string | null; xMun?: string | null; UF?: string | null; CEP?: string | null;
}
export interface DestInfo { nome?: string | null; doc?: string | null; ie?: string | null; email?: string | null; fone?: string | null; ender: DestAddress }

/** Destinatário <dest> do XML autorizado (NF-e 55). null se não houver <dest>. */
export function parseXmlDest(xml: string | null | undefined): DestInfo | null {
  if (!xml) return null;
  const dest = tag(xml, "dest");
  if (!dest) return null;
  const e = tag(dest, "enderDest") || "";
  const t = (s: string, n: string) => decode(tag(s, n));
  return {
    nome: t(dest, "xNome"), doc: t(dest, "CPF") || t(dest, "CNPJ"), ie: t(dest, "IE"),
    email: t(dest, "email"), fone: t(e, "fone"),
    ender: { xLgr: t(e, "xLgr"), nro: t(e, "nro"), xCpl: t(e, "xCpl"), xBairro: t(e, "xBairro"),
      cMun: t(e, "cMun"), xMun: t(e, "xMun"), UF: t(e, "UF"), CEP: t(e, "CEP") },
  };
}

export interface XmlItem { cProd: string | null; cEAN: string | null; xProd: string | null; NCM: string | null; CEST: string | null; orig: number | null; uCom: string | null; csosn: string | null; cstIcms: string | null }
export function parseXmlItems(xml: string | null | undefined): XmlItem[] {
  if (!xml) return [];
  const out: XmlItem[] = [];
  for (const m of xml.matchAll(/<det nItem="\d+">([\s\S]*?)<\/det>/g)) {
    const d = m[1]; const prod = tag(d, "prod") || ""; const icms = tag(d, "ICMS") || "";
    const orig = tag(icms, "orig");
    out.push({ cProd: tag(prod, "cProd"), cEAN: tag(prod, "cEAN"), xProd: decode(tag(prod, "xProd")), NCM: tag(prod, "NCM"),
      CEST: tag(prod, "CEST"), orig: orig != null ? Number(orig) : null, uCom: tag(prod, "uCom"),
      csosn: tag(icms, "CSOSN"), cstIcms: tag(icms, "CST") });
  }
  return out;
}
/** Casa o item devolvido com o item do XML: código, depois GTIN, depois posição. */
export function matchXmlItem(items: XmlItem[], keys: { sku?: string | null; barcode?: string | null; index?: number }): XmlItem | null {
  const k = [keys.sku, keys.barcode].filter(Boolean).map(String);
  return items.find((i) => k.includes(String(i.cProd))) || items.find((i) => k.includes(String(i.cEAN)))
    || (keys.index != null && items.length === 1 ? items[0] : null);
}

const pick = (...v: any[]) => { for (const x of v) { const s = x == null ? "" : String(x).trim(); if (s) return s; } return ""; };
const digits = (s: any) => String(s ?? "").replace(/\D/g, "");

/** XML primeiro; cadastro/pedido só para o que faltar no XML. */
export function mergeDest(xml: DestInfo | null, fb: DestInfo): DestInfo & { fonte: "xml" | "cadastro" | "misto" } {
  const x = xml?.ender || {}; const f = fb.ender || {};
  const keys: (keyof DestAddress)[] = ["xLgr","nro","xCpl","xBairro","cMun","xMun","UF","CEP"];
  let fromXml = 0, fromFb = 0;
  const ender: DestAddress = {};
  for (const k of keys) {
    const a = pick(x[k]); const b = pick(f[k]);
    if (a) { ender[k] = a; fromXml++; } else if (b) { ender[k] = b; fromFb++; } else ender[k] = null;
  }
  const r = (a: any, b: any) => pick(a) || pick(b) || null;
  return { nome: r(xml?.nome, fb.nome), doc: digits(r(xml?.doc, fb.doc)) || null, ie: r(xml?.ie, fb.ie),
    email: r(xml?.email, fb.email), fone: r(xml?.fone, fb.fone), ender,
    fonte: fromFb === 0 && fromXml > 0 ? "xml" : fromXml === 0 ? "cadastro" : "misto" };
}

/** CFOP de entrada por devolução de venda: 1.202 mesma UF, 2.202 outra UF. */
export function cfopEntrada(ufEmit: string, ufDest: string | null | undefined): "1202" | "2202" {
  return String(ufDest || ufEmit).toUpperCase() === String(ufEmit).toUpperCase() ? "1202" : "2202";
}
/** CST PIS/COFINS de saída (01–49) → entrada (50–99). Mesma regra já usada pelo emissor:
 *  01/02 com alíquota > 0 → 50 (mantém base); qualquer outro (07, 49, Simples etc.) → 98 zerado. */
export function cstEntradaPisCofins(cstSaida: any, aliq: number, vBase: number) {
  const c = String(cstSaida ?? "").replace(/\D/g, "").padStart(2, "0");
  if ((c === "01" || c === "02") && aliq > 0) return { cst: "50", aliq, base: vBase };
  return { cst: "98", aliq: 0, base: 0 };
}

/** Pré-checagem: devolve a lista do que falta (vazia = pode mandar à SEFAZ). */
export function precheckDevolucao(input: { ender: DestAddress; ufEmit: string; cfops: string[]; csts: string[]; cfopOverride?: boolean }): string[] {
  const e = input.ender; const p: string[] = [];
  const uf = String(e.UF || "").toUpperCase();
  if (!UF_IBGE[uf]) p.push("estado (UF)");
  const cMun = digits(e.cMun);
  if (cMun.length !== 7) p.push("código do município");
  else if (UF_IBGE[uf] && !cMun.startsWith(UF_IBGE[uf])) p.push("município não bate com o estado");
  if (String(e.xBairro || "").replace(/[^A-Za-zÀ-ÿ0-9]/g, "").length < 2) p.push("bairro");
  if (digits(e.CEP).length !== 8) p.push("CEP");
  if (!pick(e.xLgr)) p.push("rua");
  if (!pick(e.xMun)) p.push("cidade");
  const esperado = UF_IBGE[uf] ? cfopEntrada(input.ufEmit, uf) : null;
  for (const c of input.cfops) {
    if (!/^[12]\d{3}$/.test(c)) { p.push(`CFOP ${c} não é de entrada`); break; }
    if (!input.cfopOverride && esperado && c !== esperado) { p.push(`CFOP ${c} não combina com o estado (esperado ${esperado})`); break; }
  }
  for (const c of input.csts) if (!(Number(c) >= 50 && Number(c) <= 99)) { p.push(`CST PIS/COFINS ${c} não é de entrada`); break; }
  return [...new Set(p)];
}
export const missingAddressMessage = (faltas: string[]) => `Faltam dados de endereço da cliente: ${faltas.join(", ")}`;
