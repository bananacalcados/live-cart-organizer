// Regras determinísticas da moderação de comentários (sem IA, testáveis).
export type ModClass = "pedido_rastreio" | "acusacao" | "ofensa_spam" | "duvida" | "neutro_positivo";
export const MOD_CLASSES: ModClass[] = ["pedido_rastreio", "acusacao", "ofensa_spam", "duvida", "neutro_positivo"];

export interface ModSettings {
  enabled: boolean;
  class_enabled: Record<string, boolean>;
  acusacao_min_confidence: number;
}

export interface ModDecision {
  finalClass: ModClass;
  hide: boolean;
  privateReply: boolean;
  toContact: boolean;
  suggestPublicReply: boolean;
}

export function normalizeClass(raw: unknown): ModClass | null {
  const v = String(raw || "").trim().toLowerCase();
  return (MOD_CLASSES as string[]).includes(v) ? (v as ModClass) : null;
}

/** Decide a ação. Acusação com confiança baixa vira dúvida (não oculta). */
export function decideModeration(cls: ModClass, confidence: number, s: ModSettings): ModDecision {
  let finalClass = cls;
  if (cls === "acusacao" && !(confidence >= Number(s.acusacao_min_confidence ?? 0.85))) finalClass = "duvida";
  const on = s.enabled && s.class_enabled?.[finalClass] !== false;
  const hiddenClass = finalClass === "pedido_rastreio" || finalClass === "acusacao" || finalClass === "ofensa_spam";
  return {
    finalClass,
    hide: on && hiddenClass,
    privateReply: on && finalClass === "pedido_rastreio",
    toContact: on && finalClass === "acusacao",
    suggestPublicReply: on && finalClass === "duvida",
  };
}

/** Comentário que nunca entra na moderação. */
export function skipReason(input: {
  isLive: boolean;
  copiedToLive: boolean;
  username: string | null | undefined;
  fromId: string | null | undefined;
  accountId: string | null | undefined;
  ownUsernames: string[];
  teamUsernames: string[];
}): string | null {
  if (input.isLive) return "live";
  if (input.copiedToLive) return "copiado_para_live";
  const u = String(input.username || "").replace(/^@/, "").toLowerCase();
  if (input.fromId && input.accountId && input.fromId === input.accountId) return "propria_conta";
  if (u && input.ownUsernames.map((x) => x.toLowerCase()).includes(u)) return "propria_conta";
  if (u && input.teamUsernames.map((x) => x.replace(/^@/, "").toLowerCase()).includes(u)) return "equipe";
  return null;
}

export function firstName(name: string | null | undefined, username: string | null | undefined): string {
  const n = String(name || "").trim().split(/\s+/)[0];
  if (n) return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
  return String(username || "").replace(/^@/, "") || "tudo bem";
}

export function buildPrivateReply(tpl: string, suffix: string, first: string, trackingUrl: string | null): string {
  let txt = tpl.replace(/\{primeiro_nome\}/g, first);
  if (trackingUrl) {
    txt = txt.includes("{link_rastreio}")
      ? txt.replace(/\{link_rastreio\}/g, trackingUrl)
      : `${txt}\n\n${suffix.replace(/\{link_rastreio\}/g, trackingUrl)}`;
  } else {
    txt = txt.replace(/\{link_rastreio\}/g, "").trim();
  }
  return txt.slice(0, 1000);
}

/** Códigos da Meta que indicam limite de uso: pausar a fila. */
export function isRateLimitError(body: any): boolean {
  const code = Number(body?.error?.code);
  return [4, 17, 32, 613].includes(code);
}
