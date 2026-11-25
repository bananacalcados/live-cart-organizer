// Cadeia de tentativas da IA do suporte. Erro transitório nunca pausa nada:
// modelo principal → (2 s) principal de novo → (8 s) modelo alternativo → Claude (reserva).
export type SupportAiAttempt = {
  attempt: number;
  model: string;
  ok: boolean;
  durationMs: number;
  error?: string;
};

/** Claude como motor reserva (chave própria ANTHROPIC_API_KEY): rápido/barato na triagem, melhor no agente. */
export const SUPPORT_CLAUDE_TRIAGE_MODEL = "claude-haiku-4-5";
export const SUPPORT_CLAUDE_AGENT_MODEL = "claude-sonnet-4-6";
export const SUPPORT_RETRY_WAITS_MS = [2000, 8000] as const;
export const isClaudeModel = (model: string) => /^(anthropic\/)?claude/i.test(model.trim());
const providerOf = (model: string) => isClaudeModel(model) ? "anthropic" : "lovable_ai";

type RetryOptions<T> = {
  primaryModel: string;
  alternateModel: string;
  /** Modelo Claude; null quando não há chave. */
  fallbackModel?: string | null;
  run: (model: string, attempt: number) => Promise<T>;
  onAttempt: (result: SupportAiAttempt) => Promise<void> | void;
  wait?: (ms: number) => Promise<void>;
};

const errorStatus = (error: unknown): number | null => {
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const status = Number(e?.statusCode ?? e?.status ?? e?.response?.status);
  return Number.isFinite(status) && status > 0 ? status : null;
};

export type SupportAiErrorKind = "terminal" | "provider" | "transient";

/**
 * terminal: teto/pausa vigente ou recusa de conteúdo real — não repete, vai para a equipe.
 * provider: conta/pedido recusado por aquele provedor (400/401/402/403/404) — pula para o próximo provedor.
 * transient: stream vazio ("No output generated"), 5xx, 429, tempo esgotado, rede, saída inválida.
 */
export function classifySupportAiError(error: unknown): SupportAiErrorKind {
  const message = String((error as Error)?.message ?? error ?? "");
  if (/reserva_recusada|teto_diario|ia_pausada/i.test(message)) return "terminal";
  if (/recusa_de_conteudo/i.test(message)) return "terminal";
  const status = errorStatus(error) ?? Number(message.match(/HTTP (\d{3})/)?.[1] ?? NaN);
  if ([400, 401, 402, 403, 404, 422].includes(status)) return "provider";
  if (/sem_chave_claude/i.test(message)) return "provider";
  return "transient";
}

export function isTimeoutError(error: unknown): boolean {
  const e = error as { name?: string; message?: string };
  return /TimeoutError|AbortError/.test(e?.name ?? "") || /timeout|tempo esgotado|aborted/i.test(String(e?.message ?? ""));
}

/** Compatibilidade: tudo que não é terminal segue para a próxima tentativa da cadeia. */
export function shouldRetrySupportAi(error: unknown): boolean {
  return classifySupportAiError(error) !== "terminal";
}

export function supportAlternateModel(primary: string, alternate: string): string {
  const other = alternate.trim();
  if (other && other !== primary) return other;
  return primary === "openai/gpt-6-luna" ? "openai/gpt-6-astra" : "openai/gpt-6-luna";
}

export function supportAiPlan(primary: string, alternate: string, fallback?: string | null) {
  const second = supportAlternateModel(primary, alternate);
  return [
    { model: primary, waitMs: 0 },
    { model: primary, waitMs: SUPPORT_RETRY_WAITS_MS[0] },
    { model: second, waitMs: SUPPORT_RETRY_WAITS_MS[1] },
    ...(fallback ? [{ model: fallback, waitMs: 0 }] : []),
  ];
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Erro final marcado com supportAiExhausted=true quando todos os provedores falharam (sem erro terminal). */
export async function runSupportAiWithRetry<T>(options: RetryOptions<T>): Promise<T> {
  const plan = supportAiPlan(options.primaryModel, options.alternateModel, options.fallbackModel);
  let attempt = 0; let lastError: unknown = null; let lastModel = ""; let lastKind: SupportAiErrorKind | null = null;
  for (const step of plan) {
    if (lastError) {
      // Conta/pedido recusado pelo provedor: não insiste no mesmo provedor. Tempo esgotado: não repete o mesmo modelo.
      if (lastKind === "provider" && providerOf(step.model) === providerOf(lastModel)) continue;
      if (isTimeoutError(lastError) && step.model === lastModel) continue;
      if (step.waitMs) await (options.wait ?? pause)(step.waitMs);
    }
    attempt++;
    const started = Date.now();
    try {
      const value = await options.run(step.model, attempt);
      await options.onAttempt({ attempt, model: step.model, ok: true, durationMs: Date.now() - started });
      return value;
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 400);
      await options.onAttempt({ attempt, model: step.model, ok: false, durationMs: Date.now() - started, error: message });
      lastError = error; lastModel = step.model; lastKind = classifySupportAiError(error);
      if (lastKind === "terminal") throw error;
    }
  }
  const final = lastError instanceof Error ? lastError : new Error(String(lastError ?? "tentativas_de_ia_esgotadas"));
  try { (final as any).supportAiExhausted = true; } catch { /* objeto congelado */ }
  throw final;
}
