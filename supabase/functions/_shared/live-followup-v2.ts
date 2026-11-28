// Peças puras do enviador v2 dos follow-ups (testáveis sem banco/provedor).
export const D_STEP_SKIP_REASON = 'respondeu_desde_envio_anterior';
/** Tempo mínimo que precisa sobrar para começar um envio (verificação + digitação + envio com timeout de 20 s). */
export const SEND_RESERVE_MS = 25_000;

export interface LoopDeps<J> {
  claim: (instance: string) => Promise<J | null>;
  process: (job: J) => Promise<boolean>;
  /** Próximo horário liberado pelo ritmo anti-ban; null = pausada/sem informação. */
  nextSendAt: (instance: string) => Promise<number | null>;
  hasDue: (instance: string) => Promise<boolean>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** Um laço independente por instância; erro numa mensagem nunca para o laço nem as outras instâncias. */
export async function runInstanceLoops<J>(instances: string[], deps: LoopDeps<J>, budgetMs: number) {
  const deadline = deps.now() + budgetMs;
  const perInstance: Record<string, { sent: number; processed: number; errors: number }> = {};
  await Promise.all(instances.map(async (id) => {
    const st = perInstance[id] = { sent: 0, processed: 0, errors: 0 };
    let idleClaims = 0;
    while (deadline - deps.now() > SEND_RESERVE_MS) {
      let job: J | null = null;
      try { job = await deps.claim(id); } catch { st.errors++; break; }
      if (job) {
        idleClaims = 0; st.processed++;
        try { if (await deps.process(job)) st.sent++; } catch { st.errors++; }
        continue;
      }
      // Nada reservado: ou acabou, ou o ritmo ainda não liberou, ou a próxima mensagem está bloqueada.
      if (!(await deps.hasDue(id).catch(() => false))) break;
      const next = await deps.nextSendAt(id).catch(() => null);
      if (next === null) break;
      const wait = Math.max(next - deps.now(), 0) + 250;
      if (wait <= 250 && ++idleClaims > 2) break; // liberado mas nada reservável (ex.: etapa anterior pendente)
      if (deps.now() + wait > deadline - SEND_RESERVE_MS) break;
      await deps.sleep(wait);
    }
  }));
  const totals = Object.values(perInstance).reduce((a, s) => ({ sent: a.sent + s.sent, processed: a.processed + s.processed }), { sent: 0, processed: 0 });
  return { sender: 'v2', instances: instances.length, ...totals, perInstance };
}

/** Regra do D (decisão de 28/11/2026): resposta desde o envio anterior (ou do link, na 1ª) pula só esta etapa. */
export function dStepAction(repliedSincePrevious: boolean): 'send' | 'skip_step' {
  return repliedSincePrevious ? 'skip_step' : 'send';
}
