// Classificação de erros de envio da Cloud API da Meta. Centraliza a decisão de
// "o que fazer" diante de uma falha de envio:
//
//   - rate_limit      → a Meta limitou temporariamente. NÃO conta tentativa e
//                       reagenda em poucos minutos.
//   - media           → a Meta não conseguiu baixar a mídia do header (131053).
//                       É TRANSITÓRIO (pico no nosso storage/CDN): reagenda em
//                       ~2min, não consome tentativa e é elegível a fallback.
//   - billing         → cobrança pendente na conta WABA (131042). NENHUM envio
//                       passa até resolver: o lote deve ser PAUSADO e o operador
//                       avisado. Não consome tentativa.
//   - undeliverable   → a Meta NÃO consegue entregar para aquele número
//                       (não é WhatsApp, número inválido, recusado). Terminal.
//   - transient       → erro desconhecido/temporário. Reagenda em ~30min até o
//                       limite de tentativas, depois vira `falhou`.
//
// `fallbackEligible` marca as falhas NÃO terminais que valem uma segunda via por
// outro provider (uazapi/wasender) em texto — ver `_shared/meta-fallback.ts`.

export type SendErrorKind = "rate_limit" | "media" | "billing" | "undeliverable" | "transient";

export interface ClassifiedSendError {
  kind: SendErrorKind;
  code: number | null;
  /** Status final que a linha de campanha_envios deve assumir nesta falha. */
  status: "pendente" | "nao_entregavel" | "falhou";
  /** Se esta falha consome uma tentativa (rate limit/mídia/cobrança não consomem). */
  countsAttempt: boolean;
  /** Em quantos ms reagendar a próxima tentativa (null = não reagenda). */
  retryMs: number | null;
  /** Vale tentar entregar por outro provider (texto) enquanto isso. */
  fallbackEligible: boolean;
  /** Exige pausar o lote inteiro e alertar o operador. */
  pauseBatch: boolean;
}

// Rate limit / throughput — liberado em minutos.
const RATE_LIMIT_CODES = new Set<number>([130429, 131056, 80007, 133016, 131048]);

// Falha ao baixar a mídia do header (link público). Transitório, MAS conta
// tentativa: sem isso o envio era reagendado infinitamente a cada 2 min e o
// mesmo cliente recebia a campanha várias vezes no mesmo dia.
const MEDIA_CODES = new Set<number>([131053]);

// Cobrança pendente / conta bloqueada por pagamento.
const BILLING_CODES = new Set<number>([131042]);

// Entrega impossível (terminal): número sem WhatsApp, inválido, recusado,
// bloqueio de qualidade do ecossistema (131049) e número em experimento da Meta
// (130472). Reenviar nesses casos não entrega nada e ainda queima reputação.
const UNDELIVERABLE_CODES = new Set<number>([
  131026, 131021, 131051, 131008, 131047, 470, 131000, 131049, 130472,
]);

const RATE_RETRY_MS = 15 * 60 * 1000; // 15 minutos
const MEDIA_RETRY_MS = 30 * 60 * 1000; // 30 minutos
const BILLING_RETRY_MS = 30 * 60 * 1000; // 30 minutos
const TRANSIENT_RETRY_MS = 30 * 60 * 1000; // 30 minutos


/** Extrai o código de erro numérico da Meta de um objeto, número ou string. */
export function extractMetaErrorCode(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "object") {
    const o = raw as Record<string, any>;
    const c = o?.error?.code ?? o?.code;
    if (typeof c === "number") return c;
    if (typeof c === "string" && /^\d+$/.test(c)) return Number(c);
    try { return extractMetaErrorCode(JSON.stringify(o)); } catch { return null; }
  }
  const s = String(raw);
  const m =
    s.match(/"code"\s*:\s*(\d+)/) ||
    s.match(/\((\d{3,6})\)/) ||
    s.match(/\b(1\d{5})\b/);
  return m ? Number(m[1]) : null;
}

/** Decide o tratamento de uma falha de envio a partir do código e/ou mensagem. */
export function classifySendError(code: number | null, message?: string): ClassifiedSendError {
  const msg = (message || "").toLowerCase();

  const isRate =
    (code != null && RATE_LIMIT_CODES.has(code)) ||
    msg.includes("rate limit") ||
    msg.includes("too many") ||
    msg.includes("throughput");

  const isMedia =
    (code != null && MEDIA_CODES.has(code)) ||
    msg.includes("failed to download media") ||
    msg.includes("error downloading media") ||
    msg.includes("media download");

  const isBilling =
    (code != null && BILLING_CODES.has(code)) ||
    msg.includes("unsettled") ||
    msg.includes("payment") ||
    msg.includes("billing");

  const isUndeliverable =
    (code != null && UNDELIVERABLE_CODES.has(code)) ||
    msg.includes("undeliverable") ||
    msg.includes("not a whatsapp") ||
    msg.includes("invalid wa_id") ||
    msg.includes("recipient");

  if (isBilling) {
    return {
      kind: "billing", code, status: "pendente", countsAttempt: false,
      retryMs: BILLING_RETRY_MS, fallbackEligible: true, pauseBatch: true,
    };
  }
  if (isMedia) {
    return {
      kind: "media", code, status: "pendente", countsAttempt: true,
      retryMs: MEDIA_RETRY_MS, fallbackEligible: true, pauseBatch: false,
    };
  }

  if (isRate) {
    return {
      kind: "rate_limit", code, status: "pendente", countsAttempt: false,
      retryMs: RATE_RETRY_MS, fallbackEligible: false, pauseBatch: false,
    };
  }
  if (isUndeliverable) {
    return {
      kind: "undeliverable", code, status: "nao_entregavel", countsAttempt: true,
      retryMs: null, fallbackEligible: false, pauseBatch: false,
    };
  }
  return {
    kind: "transient", code, status: "pendente", countsAttempt: true,
    retryMs: TRANSIENT_RETRY_MS, fallbackEligible: false, pauseBatch: false,
  };
}
