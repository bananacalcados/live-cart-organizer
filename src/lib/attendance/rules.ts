/**
 * Engine puro (sem IA, sem efeitos colaterais) de regras de atendimento.
 *
 * `evaluateDraft` recebe o rascunho atual + contexto da conversa + config das
 * regras e devolve a lista de avisos a mostrar. Não altera o texto nem bloqueia
 * o envio — é só uma camada de sugestão.
 *
 * Para adicionar uma regra nova no futuro, basta:
 *  1. acrescentar uma entrada em `chat_attendance_rules`;
 *  2. tratar a `rule_key` aqui dentro.
 */
import { DEFAULT_CLOSING_PHRASES, normalizeText } from "./closingPhrases";

export interface AttendanceNudge {
  /** chave estável da regra que gerou o aviso */
  ruleKey: string;
  /** texto curto exibido pra vendedora */
  message: string;
}

export interface DraftContext {
  /** conversa marcada como finalizada */
  isFinished?: boolean;
  /** conversa marcada como paga / aguardando pagamento resolvido */
  isPaid?: boolean;
}

export interface RuleConfig {
  enabled: boolean;
  config: Record<string, unknown>;
}

export type RulesMap = Record<string, RuleConfig>;

const URL_OR_EMOJI_ONLY =
  /^(?:\s|https?:\/\/\S+|[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f])+$/u;

function endsWithQuestion(text: string): boolean {
  // ignora espaços e emojis no final
  const trimmed = text.replace(/[\s\p{Extended_Pictographic}\ufe0f]+$/u, "");
  return trimmed.endsWith("?");
}

function containsClosingPhrase(normalized: string, phrases: string[]): boolean {
  return phrases.some((p) => p && normalized.includes(normalizeText(p)));
}

/**
 * Avalia o rascunho e devolve os avisos ativos.
 * Idempotente e seguro — nunca lança.
 */
export function evaluateDraft(
  rawText: string,
  ctx: DraftContext,
  rules: RulesMap,
): AttendanceNudge[] {
  const nudges: AttendanceNudge[] = [];
  const text = (rawText || "").trim();
  if (!text) return nudges;

  // ── Regra: terminar com pergunta ──
  const rule = rules["end_with_question"];
  if (rule?.enabled) {
    const cfg = rule.config || {};
    const minLength = typeof cfg.min_length === "number" ? cfg.min_length : 12;
    const message =
      typeof cfg.message === "string" && cfg.message.trim()
        ? cfg.message
        : "Sua mensagem não termina com pergunta. Que tal puxar uma resposta da cliente?";
    const phrases = Array.isArray(cfg.closing_phrases)
      ? (cfg.closing_phrases as string[])
      : DEFAULT_CLOSING_PHRASES;

    const normalized = normalizeText(text);
    const tooShort = text.length < minLength;
    const onlyUrlOrEmoji = URL_OR_EMOJI_ONLY.test(rawText);

    const exempt =
      ctx.isFinished ||
      ctx.isPaid ||
      tooShort ||
      onlyUrlOrEmoji ||
      endsWithQuestion(text) ||
      containsClosingPhrase(normalized, phrases);

    if (!exempt) {
      nudges.push({ ruleKey: "end_with_question", message });
    }
  }

  return nudges;
}
