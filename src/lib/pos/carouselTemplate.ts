// Helpers for building WhatsApp carousel templates from a friendly editor
// that uses NAMED variable tokens like {{nome}} / {{tamanho}} / {{livre_1}}.
// Meta only accepts POSITIONAL variables ({{1}}, {{2}}...), so we convert
// named tokens -> positional and build the matching example array.

export interface VarDef {
  token: string; // e.g. "nome", "tamanho", "livre_1"
  label: string; // human label shown in the UI
  example: string; // value used ONLY for Meta approval preview
}

export const STANDARD_VARS: VarDef[] = [
  { token: "nome", label: "Nome do cliente", example: "Maria" },
  { token: "tamanho", label: "Tamanho que calça", example: "37" },
  { token: "primeiro_nome", label: "Primeiro nome", example: "Maria" },
];

const TOKEN_RE = /\{\{\s*([\w-]+)\s*\}\}/g;

/**
 * Convert friendly text with named tokens into a Meta-ready component:
 * returns positional text ({{1}}, {{2}}...) and the ordered example values.
 * Static text (no tokens) returns examples: [].
 */
export function buildComponentText(
  raw: string,
  vars: VarDef[],
): { text: string; examples: string[] } {
  const examples: string[] = [];
  let idx = 0;
  const text = (raw || "").replace(TOKEN_RE, (_m, token: string) => {
    idx += 1;
    const v = vars.find((x) => x.token === token);
    examples.push(v?.example || token);
    return `{{${idx}}}`;
  });
  return { text, examples };
}

/** Build a friendly preview replacing named tokens with their example values. */
export function previewText(raw: string, vars: VarDef[]): string {
  return (raw || "").replace(TOKEN_RE, (_m, token: string) => {
    const v = vars.find((x) => x.token === token);
    return v?.example || `{{${token}}}`;
  });
}

export type ButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

export interface BuiltButton {
  type: ButtonType;
  text: string;
  url?: string;
  urlExample?: string;
  phone?: string;
}

export const BUTTON_TYPE_LABEL: Record<ButtonType, string> = {
  QUICK_REPLY: "Resposta rápida",
  URL: "Link (URL)",
  PHONE_NUMBER: "Ligar (telefone)",
};
