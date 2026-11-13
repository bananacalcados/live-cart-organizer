export type SupportAiAttempt = {
  attempt: number;
  model: string;
  ok: boolean;
  durationMs: number;
  error?: string;
};

type RetryOptions<T> = {
  primaryModel: string;
  alternateModel: string;
  run: (model: string, attempt: number) => Promise<T>;
  onAttempt: (result: SupportAiAttempt) => Promise<void> | void;
  wait?: (ms: number) => Promise<void>;
};

const errorStatus = (error: unknown): number | null => {
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const value = e?.statusCode ?? e?.status ?? e?.response?.status;
  const status = Number(value);
  return Number.isFinite(status) ? status : null;
};

/** Só repete falha local vazia/interrompida ou erro transitório. Nunca repete recusa, conta ou tempo esgotado. */
export function shouldRetrySupportAi(error: unknown): boolean {
  const e = error as { name?: string; message?: string; text?: unknown };
  const message = String(e?.message ?? error ?? "");
  if (/abort|timeout|tempo esgotado|recusa|refusal|denied/i.test(`${e?.name ?? ""} ${message}`)) return false;
  // Resposta HTTP OK porém triagem/agente inválidos: vale a 2ª tentativa no outro modelo.
  if (/triagem_vazia_ou_invalida|resposta_do_agente_invalida/i.test(message)) return true;
  const status = errorStatus(error);
  if (status !== null) return status === 429 || status >= 500;
  if (/No output generated|stream_interrompido|stream vazio|ia_sem_stream/i.test(message)) {
    return typeof e?.text !== "string" || e.text.trim().length === 0;
  }
  return false;
}

export function supportAlternateModel(primary: string, alternate: string): string {
  const other = alternate.trim();
  if (other && other !== primary) return other;
  return primary === "openai/gpt-6-luna" ? "openai/gpt-6-astra" : "openai/gpt-6-luna";
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** No máximo duas tentativas; a segunda sempre troca o modelo. */
export async function runSupportAiWithRetry<T>(options: RetryOptions<T>): Promise<T> {
  const secondModel = supportAlternateModel(options.primaryModel, options.alternateModel);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const model = attempt === 1 ? options.primaryModel : secondModel;
    const started = Date.now();
    try {
      const value = await options.run(model, attempt);
      await options.onAttempt({ attempt, model, ok: true, durationMs: Date.now() - started });
      return value;
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 400);
      await options.onAttempt({ attempt, model, ok: false, durationMs: Date.now() - started, error: message });
      if (attempt === 2 || !shouldRetrySupportAi(error)) throw error;
      await (options.wait ?? pause)(750);
    }
  }
  throw new Error("tentativas_de_ia_esgotadas");
}
