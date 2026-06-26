// Classificação de erros de envio da Cloud API da Meta para as campanhas de
// carrossel (campanha_envios). Centraliza a decisão de "o que fazer" diante de
// uma falha de envio:
//
//   - rate_limit      → a Meta limitou temporariamente. NÃO conta tentativa e
//                       reagenda em poucos minutos (a janela é liberada rápido).
//   - undeliverable   → a Meta NÃO consegue entregar para aquele número
//                       (não é WhatsApp, número inválido, recusado). É terminal:
//                       marca como `nao_entregavel` e NÃO tenta de novo por dias.
//   - transient       → erro desconhecido/temporário. Reagenda em ~30min até o
//                       limite de tentativas, depois vira `falhou`.
//
// O erro 131026 ("Message undeliverable") é o caso mais comum: significa que a
// Meta não conseguiu entregar a mensagem ao destinatário — normalmente porque o
// número não tem WhatsApp ativo, é inválido, ou o aparelho não aceitou a
// mensagem. NÃO é erro do nosso sistema; é o número que não recebe.

export type SendErrorKind = "rate_limit" | "undeliverable" | "transient";

export interface ClassifiedSendError {
  kind: SendErrorKind;
  code: number | null;
  /** Status final que a linha de campanha_envios deve assumir nesta falha. */
  status: "pendente" | "nao_entregavel" | "falhou";
  /** Se esta falha consome uma tentativa (rate limit não consome). */
  countsAttempt: boolean;
  /** Em quantos ms reagendar a próxima tentativa (null = não reagenda). */
  retryMs: number | null;
}

// Rate limit / throughput — liberado em minutos.
const RATE_LIMIT_CODES = new Set<number>([130429, 131056, 80007, 133016, 131048]);

// Entrega impossível (terminal): número sem WhatsApp, inválido, recusado.
const UNDELIVERABLE_CODES = new Set<number>([131026, 131021, 131051, 131008, 131047, 470, 131000]);

const RATE_RETRY_MS = 5 * 60 * 1000; // 5 minutos
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
    // tenta serializar e cair no regex abaixo
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

  const isUndeliverable =
    (code != null && UNDELIVERABLE_CODES.has(code)) ||
    msg.includes("undeliverable") ||
    msg.includes("not a whatsapp") ||
    msg.includes("invalid wa_id") ||
    msg.includes("recipient");

  if (isRate) {
    return { kind: "rate_limit", code, status: "pendente", countsAttempt: false, retryMs: RATE_RETRY_MS };
  }
  if (isUndeliverable) {
    return { kind: "undeliverable", code, status: "nao_entregavel", countsAttempt: true, retryMs: null };
  }
  return { kind: "transient", code, status: "pendente", countsAttempt: true, retryMs: TRANSIENT_RETRY_MS };
}
