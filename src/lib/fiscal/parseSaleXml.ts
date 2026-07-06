// Parser do XML de NF-e de SAÍDA (modelo 55) para alimentar registros
// Sintegra 50/54. Usa DOMParser (browser). Retorna itens e totais de ICMS.

export interface SaleXmlItem {
  ordem: number;
  codigo: string;
  descricao: string;
  ncm?: string;
  cfop?: string;
  cst?: string;
  unidade?: string;
  quantidade: number;
  valor_bruto: number;
  desconto: number;
  base_icms: number;
  valor_ipi: number;
  aliquota_icms: number;
}

export interface SaleXmlParsed {
  base_icms: number;
  valor_icms: number;
  valor_isento: number;
  outras: number;
  cfop_predominante?: string;
  items: SaleXmlItem[];
}

function txt(node: Element | null | undefined, tag: string): string | undefined {
  if (!node) return undefined;
  const el = node.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() || undefined;
}

function n(node: Element | null | undefined, tag: string): number {
  const v = txt(node, tag);
  if (!v) return 0;
  const f = parseFloat(v.replace(",", "."));
  return isNaN(f) ? 0 : f;
}

export function parseSaleXml(xml: string): SaleXmlParsed | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.getElementsByTagName("parsererror")[0]) return null;

    const total = doc.getElementsByTagName("ICMSTot")[0] || null;
    const base_icms = n(total, "vBC");
    const valor_icms = n(total, "vICMS");
    // vNF total menos base tributada aproxima isento/outras
    const outras = 0;
    const valor_isento = 0;

    const dets = Array.from(doc.getElementsByTagName("det"));
    const items: SaleXmlItem[] = [];
    const cfopCount: Record<string, number> = {};

    dets.forEach((det, i) => {
      const prod = det.getElementsByTagName("prod")[0] || null;
      const imposto = det.getElementsByTagName("imposto")[0] || null;
      const icmsNode = imposto?.getElementsByTagName("ICMS")[0] || null;
      const icmsInner = icmsNode?.firstElementChild || null;

      const cfop = txt(prod, "CFOP");
      if (cfop) cfopCount[cfop] = (cfopCount[cfop] || 0) + 1;

      items.push({
        ordem: i + 1,
        codigo: txt(prod, "cProd") || String(i + 1),
        descricao: txt(prod, "xProd") || "",
        ncm: txt(prod, "NCM"),
        cfop,
        cst: txt(icmsInner, "CST") || txt(icmsInner, "CSOSN") || "000",
        unidade: txt(prod, "uCom"),
        quantidade: n(prod, "qCom"),
        valor_bruto: n(prod, "vProd"),
        desconto: n(prod, "vDesc"),
        base_icms: icmsInner ? n(icmsInner, "vBC") : 0,
        valor_ipi: imposto ? n(imposto.getElementsByTagName("IPI")[0] || null, "vIPI") : 0,
        aliquota_icms: icmsInner ? n(icmsInner, "pICMS") : 0,
      });
    });

    let cfop_predominante: string | undefined;
    let max = -1;
    for (const [k, v] of Object.entries(cfopCount)) {
      if (v > max) { max = v; cfop_predominante = k; }
    }

    return { base_icms, valor_icms, valor_isento, outras, cfop_predominante, items };
  } catch {
    return null;
  }
}
