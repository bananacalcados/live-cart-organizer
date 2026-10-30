// Parser do XML de NF-e de saída — lógica compartilhada com o servidor.
import { parseSaleXmlWith } from "../../../supabase/functions/_shared/fiscal/sale-xml";
import type { SaleXmlLike } from "../../../supabase/functions/_shared/fiscal/sintegra-core";

export type SaleXmlParsed = SaleXmlLike & { valor_isento: number; outras: number };
export type SaleXmlItem = SaleXmlLike["items"][number];

export function parseSaleXml(xml: string): SaleXmlParsed | null {
  const r = parseSaleXmlWith(DOMParser, xml);
  return r ? { ...r, valor_isento: 0, outras: 0 } : null;
}
