// Montagem COMPARTILHADA do pacote de XMLs (mesma estrutura do botão "Baixar XMLs").
export function dateStamp(iso: string | null | undefined): string {
  if (!iso) return "sem-data";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "sem-data";
  const sp = new Date(d.getTime() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${sp.getUTCFullYear()}${p(sp.getUTCMonth() + 1)}${p(sp.getUTCDate())}`;
}

export function safeName(s: string): string {
  return (s || "").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

export class XmlPackage {
  files: Record<string, string> = {};
  private used = new Set<string>();
  saidas = 0; entradas = 0; saidasSemXml = 0; entradasSemXml = 0; cancelamentos = 0;

  add(folder: string, base: string, xml: string) {
    let name = `${folder}/${base}.xml`;
    let i = 2;
    while (this.used.has(name)) { name = `${folder}/${base}_${i}.xml`; i++; }
    this.used.add(name);
    this.files[name] = xml;
  }

  addSaida(r: { modelo: number; numero?: number | null; chave_acesso?: string | null; data_autorizacao?: string | null; xml_content?: string | null; cancellation_xml?: string | null }) {
    if (!r.xml_content) { this.saidasSemXml++; return; }
    const tipo = r.modelo === 65 ? "NFCe" : "NFe";
    const id = r.chave_acesso || `num${r.numero ?? "s-n"}`;
    const base = `${tipo}_${dateStamp(r.data_autorizacao)}_${safeName(id)}`;
    this.add("SAIDAS", base, r.xml_content);
    this.saidas++;
    if (r.cancellation_xml) { this.add("SAIDAS", `${base}_CANCELAMENTO`, r.cancellation_xml); this.cancelamentos++; }
  }

  addEntrada(r: { nfe_key?: string | null; invoice_number?: string | null; emission_date?: string | null; raw_xml?: string | null }) {
    if (!r.raw_xml) { this.entradasSemXml++; return; }
    const id = r.nfe_key || `num${r.invoice_number ?? "s-n"}`;
    this.add("ENTRADAS", `NFe_${dateStamp(r.emission_date)}_${safeName(id)}`, r.raw_xml);
    this.entradas++;
  }

  manifest(startIso: string, endIso: string, companyLabel: string): string {
    return [
      "Pacote de XMLs fiscais",
      `Período: ${startIso.slice(0, 10)} a ${endIso.slice(0, 10)}`,
      `Empresa: ${companyLabel}`,
      `Gerado em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
      "",
      `XMLs de saída incluídos: ${this.saidas}${this.saidasSemXml ? ` (sem XML: ${this.saidasSemXml})` : ""}`,
      `XMLs de entrada incluídos: ${this.entradas}${this.entradasSemXml ? ` (sem XML: ${this.entradasSemXml})` : ""}`,
      ...(this.cancelamentos ? [`XMLs de cancelamento incluídos: ${this.cancelamentos}`] : []),
    ].join("\r\n");
  }
}
