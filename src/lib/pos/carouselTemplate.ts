// Helpers for building WhatsApp carousel templates from a friendly editor
// that uses NAMED variable tokens like {{nome}} / {{tamanho}} / {{livre_1}}.
// Meta only accepts POSITIONAL variables ({{1}}, {{2}}...), so we convert
// named tokens -> positional and build the matching example array.

export interface VarDef {
  token: string; // e.g. "nome", "tamanho", "livre_1"
  label: string; // human label shown in the UI
  example: string; // value used ONLY for Meta approval preview
  dynamic?: "seller"; // special tokens resolved at send time (e.g. seller rotation)
}

// Special token whose value is filled at send time by rotating through the
// active POS sellers (rodízio de vendedoras).
export const SELLER_VAR_TOKEN = "vendedora";

export const STANDARD_VARS: VarDef[] = [
  { token: "nome", label: "Nome do cliente", example: "Maria" },
  { token: "primeiro_nome", label: "Primeiro nome", example: "Maria" },
  { token: "tamanho", label: "Tamanho que calça", example: "37" },
  {
    token: SELLER_VAR_TOKEN,
    label: "Nome da vendedora (rodízio)",
    example: "Jéssica",
    dynamic: "seller",
  },
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

// ---------------------------------------------------------------------------
// Reading the STRUCTURE of an approved carousel template back from Meta.
// meta-whatsapp-get-templates returns the raw template objects (components,
// carousel cards, buttons). We parse it so the campaign builder can show the
// exact body text, per-card text and buttons that were approved.
// ---------------------------------------------------------------------------

export interface ParsedTplButton {
  type: string; // QUICK_REPLY | URL | PHONE_NUMBER
  text: string;
  url?: string;
  phone?: string;
}

export interface ParsedCarouselTemplate {
  topBodyText: string;
  topVarCount: number;
  cardBodyText: string;
  cardVarCount: number;
  cards: { buttons: ParsedTplButton[] }[];
  qtdCards: number;
}

const POSITIONAL_RE = /\{\{\s*\d+\s*\}\}/g;

export function countPositionalVars(text: string | null | undefined): number {
  if (!text) return 0;
  return (text.match(POSITIONAL_RE) || []).length;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseCarouselTemplate(tpl: any): ParsedCarouselTemplate | null {
  if (!tpl || !Array.isArray(tpl.components)) return null;
  const comps = tpl.components as any[];
  const topBody = comps.find((c) => String(c?.type).toUpperCase() === "BODY");
  const carousel = comps.find((c) => String(c?.type).toUpperCase() === "CAROUSEL");
  if (!carousel || !Array.isArray(carousel.cards) || carousel.cards.length === 0) return null;

  const card0 = carousel.cards[0];
  const card0Body = (card0?.components || []).find(
    (c: any) => String(c?.type).toUpperCase() === "BODY",
  );

  const cards = carousel.cards.map((cd: any) => {
    const btnComp = (cd?.components || []).find(
      (c: any) => String(c?.type).toUpperCase() === "BUTTONS",
    );
    const buttons: ParsedTplButton[] = (btnComp?.buttons || []).map((b: any) => ({
      type: String(b?.type || "QUICK_REPLY"),
      text: String(b?.text || ""),
      url: b?.url,
      phone: b?.phone_number,
    }));
    return { buttons };
  });

  const topBodyText = topBody?.text || "";
  const cardBodyText = card0Body?.text || "";
  return {
    topBodyText,
    topVarCount: countPositionalVars(topBodyText),
    cardBodyText,
    cardVarCount: countPositionalVars(cardBodyText),
    cards,
    qtdCards: carousel.cards.length,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- Mapping the approved positional vars to our named tokens ----

export type VarKind =
  | "nome"
  | "primeiro_nome"
  | "tamanho"
  | "vendedora"
  | "legenda"
  | "livre";

export interface VarMapping {
  kind: VarKind;
  value?: string; // only for "livre"
}

export const BODY_VAR_OPTIONS: { kind: VarKind; label: string }[] = [
  { kind: "nome", label: "Nome do cliente" },
  { kind: "primeiro_nome", label: "Primeiro nome" },
  { kind: "tamanho", label: "Tamanho que calça" },
  { kind: "vendedora", label: "Nome da vendedora (rodízio)" },
  { kind: "livre", label: "Texto livre" },
];

export const CARD_VAR_OPTIONS: { kind: VarKind; label: string }[] = [
  { kind: "legenda", label: "Texto próprio de cada card" },
  { kind: "nome", label: "Nome do cliente" },
  { kind: "primeiro_nome", label: "Primeiro nome" },
  { kind: "tamanho", label: "Tamanho que calça" },
  { kind: "vendedora", label: "Nome da vendedora (rodízio)" },
  { kind: "livre", label: "Texto livre" },
];

/** Token name stored in top_body/card_body for a given mapping. */
export function mappingToken(m: VarMapping, prefix: string, idx: number): string {
  if (m.kind === "livre") return `${prefix}_${idx + 1}`;
  return m.kind;
}

/** Replace approved positional {{1}}.. with our named {{token}} in order. */
export function applyTokens(approvedText: string, tokens: string[]): string {
  let i = 0;
  return (approvedText || "").replace(POSITIONAL_RE, () => {
    const t = tokens[i] || `var_${i + 1}`;
    i += 1;
    return `{{${t}}}`;
  });
}

/** Tokens (named) found in a stored body string, in order. */
export function namedTokensOf(text: string | null | undefined): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([\w-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || "")) !== null) out.push(m[1]);
  return out;
}

/** Reverse a stored named token into a mapping (for editing). */
export function tokenToMapping(
  token: string,
  vars: Record<string, unknown> | null,
): VarMapping {
  if (["nome", "primeiro_nome", "tamanho", "vendedora", "legenda"].includes(token)) {
    return { kind: token as VarKind };
  }
  return { kind: "livre", value: vars && vars[token] != null ? String(vars[token]) : "" };
}

/** Resolve a single mapping to a friendly preview value. */
export function previewMappingValue(m: VarMapping): string {
  switch (m.kind) {
    case "nome": return "Maria";
    case "primeiro_nome": return "Maria";
    case "tamanho": return "37";
    case "vendedora": return "Jéssica";
    case "legenda": return "texto do card";
    case "livre": return m.value || "texto livre";
  }
}
