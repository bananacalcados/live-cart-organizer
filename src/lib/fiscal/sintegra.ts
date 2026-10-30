// Gerador Sintegra — a lógica fica no módulo compartilhado (mesma versão no
// navegador e na rotina do contador).
export * from "../../../supabase/functions/_shared/fiscal/sintegra-core";

/** Baixa o arquivo Sintegra como .txt (ASCII/latin1, CRLF). */
export function downloadSintegra(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=us-ascii" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".txt") ? filename : `${filename}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
