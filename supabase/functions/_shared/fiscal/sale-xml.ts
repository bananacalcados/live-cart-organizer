// Parser COMPARTILHADO do XML de NF-e de saída (Sintegra 50/54).
// Recebe o DOMParser do ambiente (navegador nativo; servidor via linkedom).
import type { SaleXmlLike } from "./sintegra-core.ts";

type DomParserCtor = new () => { parseFromString(s: string, t: string): any };

function txt(node: any, tag: string): string | undefined {
  if (!node) return undefined;
  const el = node.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() || undefined;
}
function n(node: any, tag: string): number {
  const v = txt(node, tag);
  if (!v) return 0;
  const f = parseFloat(v.replace(",", "."));
  return isNaN(f) ? 0 : f;
}

export function parseSaleXmlWith(Parser: DomParserCtor, xml: string): SaleXmlLike | null {
  try {
    const doc = new Parser().parseFromString(xml, "text/xml");
    if (doc.getElementsByTagName("parsererror")[0]) return null;
    const total = doc.getElementsByTagName("ICMSTot")[0] || null;
    const base_icms = n(total, "vBC");
    const valor_icms = n(total, "vICMS");
    const dets = Array.from(doc.getElementsByTagName("det")) as any[];
    const items: SaleXmlLike["items"] = [];
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
    for (const [k, v] of Object.entries(cfopCount)) if (v > max) { max = v; cfop_predominante = k; }
    return { base_icms, valor_icms, cfop_predominante, items };
  } catch {
    return null;
  }
}
