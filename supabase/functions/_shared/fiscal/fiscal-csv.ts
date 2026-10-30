// CSV COMPARTILHADO (mesmo formato do relatório CSV da aba Fiscal).
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const sep = ";";
  return [headers.map(csvEscape).join(sep), ...rows.map((r) => r.map(csvEscape).join(sep))].join("\r\n");
}
export function brlCell(n: number): string {
  return (Number(n) || 0).toFixed(2).replace(".", ",");
}
export function dateCell(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
export const SALES_CSV_HEADERS = ["Data", "Modelo", "CNPJ empresa", "Empresa", "Série/Número", "Chave", "Destinatário", "CPF/CNPJ", "Valor"];
