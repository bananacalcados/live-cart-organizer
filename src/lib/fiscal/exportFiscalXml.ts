// Exportador de XMLs fiscais em um único arquivo ZIP para a contabilidade.
// Empacota XMLs de saídas (fiscal_documents.xml_content) e entradas (purchase_invoices.raw_xml).

import { zipSync, strToU8 } from "fflate";
import { supabase } from "@/integrations/supabase/client";
import { XmlPackage } from "../../../supabase/functions/_shared/fiscal/xml-package";

export interface XmlExportParams {
  startIso: string;
  endIso: string;
  companyId?: string; // undefined/"all" = todas
  onProgress?: (msg: string) => void;
}

export interface XmlExportResult {
  saidas: number;
  entradas: number;
  saidasSemXml: number;
  entradasSemXml: number;
}

/**
 * Gera e baixa um ZIP com os XMLs de entrada e saída do período.
 * Estrutura: SAIDAS/NFe|NFCe_<data>_<chave|numero>.xml e ENTRADAS/<data>_<chave|numero>.xml
 */
export async function exportFiscalXmlZip(params: XmlExportParams): Promise<XmlExportResult> {
  const { startIso, endIso, companyId, onProgress } = params;
  const pkg = new XmlPackage();

  // ---------- SAÍDAS ----------
  onProgress?.("Carregando XMLs de saída…");
  const pageSize = 200;
  let from = 0;
  while (true) {
    let q = supabase
      .from("fiscal_documents")
      .select("modelo, numero, chave_acesso, data_autorizacao, xml_content")
      .in("status", ["authorized", "autorizada", "autorizado"])
      .gte("data_autorizacao", startIso)
      .lte("data_autorizacao", endIso)
      .order("data_autorizacao", { ascending: true })
      .range(from, from + pageSize - 1);
    if (companyId && companyId !== "all") q = q.eq("company_id", companyId);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data as any[]) || [];
    for (const r of rows) pkg.addSaida(r);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // ---------- ENTRADAS ----------
  onProgress?.("Carregando XMLs de entrada…");
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("purchase_invoices")
      .select("nfe_key, invoice_number, emission_date, raw_xml")
      .gte("emission_date", startIso)
      .lte("emission_date", endIso)
      .order("emission_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data as any[]) || [];
    for (const r of rows) pkg.addEntrada(r);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const { saidas, entradas, saidasSemXml, entradasSemXml } = pkg;
  if (saidas === 0 && entradas === 0) {
    return { saidas: 0, entradas: 0, saidasSemXml, entradasSemXml };
  }

  const files: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(pkg.files)) files[k] = strToU8(v);
  files["LEIA-ME.txt"] = strToU8(pkg.manifest(startIso, endIso, companyId && companyId !== "all" ? companyId : "Todas"));

  onProgress?.("Compactando…");
  const zipped = zipSync(files, { level: 6 });

  const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `xmls_fiscais_${startIso.slice(0, 10)}_a_${endIso.slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  return { saidas, entradas, saidasSemXml, entradasSemXml };
}
