// Exportador de XMLs fiscais em um único arquivo ZIP para a contabilidade.
// Empacota XMLs de saídas (fiscal_documents.xml_content) e entradas (purchase_invoices.raw_xml).

import { zipSync, strToU8 } from "fflate";
import { supabase } from "@/integrations/supabase/client";

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

function dateStamp(iso: string | null | undefined): string {
  if (!iso) return "sem-data";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "sem-data";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Remove caracteres inválidos para nome de arquivo. */
function safeName(s: string): string {
  return (s || "").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

/**
 * Gera e baixa um ZIP com os XMLs de entrada e saída do período.
 * Estrutura: SAIDAS/NFe|NFCe_<data>_<chave|numero>.xml e ENTRADAS/<data>_<chave|numero>.xml
 */
export async function exportFiscalXmlZip(params: XmlExportParams): Promise<XmlExportResult> {
  const { startIso, endIso, companyId, onProgress } = params;
  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();

  const addFile = (folder: string, base: string, xml: string) => {
    let name = `${folder}/${base}.xml`;
    let i = 2;
    while (usedNames.has(name)) {
      name = `${folder}/${base}_${i}.xml`;
      i++;
    }
    usedNames.add(name);
    files[name] = strToU8(xml);
  };

  // ---------- SAÍDAS ----------
  onProgress?.("Carregando XMLs de saída…");
  let saidas = 0;
  let saidasSemXml = 0;
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
    for (const r of rows) {
      if (!r.xml_content) { saidasSemXml++; continue; }
      const tipo = r.modelo === 65 ? "NFCe" : "NFe";
      const id = r.chave_acesso || `num${r.numero ?? "s-n"}`;
      addFile("SAIDAS", `${tipo}_${dateStamp(r.data_autorizacao)}_${safeName(id)}`, r.xml_content);
      saidas++;
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // ---------- ENTRADAS ----------
  onProgress?.("Carregando XMLs de entrada…");
  let entradas = 0;
  let entradasSemXml = 0;
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
    for (const r of rows) {
      if (!r.raw_xml) { entradasSemXml++; continue; }
      const id = r.nfe_key || `num${r.invoice_number ?? "s-n"}`;
      addFile("ENTRADAS", `NFe_${dateStamp(r.emission_date)}_${safeName(id)}`, r.raw_xml);
      entradas++;
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  if (saidas === 0 && entradas === 0) {
    return { saidas: 0, entradas: 0, saidasSemXml, entradasSemXml };
  }

  // Manifesto simples (índice) dentro do ZIP
  const manifest = [
    "Pacote de XMLs fiscais",
    `Período: ${startIso.slice(0, 10)} a ${endIso.slice(0, 10)}`,
    `Empresa: ${companyId && companyId !== "all" ? companyId : "Todas"}`,
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    "",
    `XMLs de saída incluídos: ${saidas}${saidasSemXml ? ` (sem XML: ${saidasSemXml})` : ""}`,
    `XMLs de entrada incluídos: ${entradas}${entradasSemXml ? ` (sem XML: ${entradasSemXml})` : ""}`,
  ].join("\r\n");
  files["LEIA-ME.txt"] = strToU8(manifest);

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
