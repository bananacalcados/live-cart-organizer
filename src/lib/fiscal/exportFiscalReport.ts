// Utilitário de exportação CSV para relatórios fiscais.
// Gera CSV UTF-8 com BOM (compatível com Excel PT-BR) e faz download no navegador.

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Gera e baixa um arquivo CSV.
 * @param filename nome do arquivo (sem exigir extensão .csv)
 * @param headers cabeçalhos das colunas
 * @param rows matriz de linhas (cada linha é um array de células)
 */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const sep = ";"; // ponto-e-vírgula = padrão Excel PT-BR
  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(sep));
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(sep));
  }
  const csv = lines.join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Formata número como moeda BRL para célula de CSV (sem símbolo, vírgula decimal). */
export function brlCell(n: number): string {
  return (Number(n) || 0).toFixed(2).replace(".", ",");
}

/** Formata data ISO para dd/mm/aaaa. */
export function dateCell(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}
