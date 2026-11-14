/** Decisão pura do Direct de cadastro da live (private reply com botão).
 * O follow-up global cuida do WhatsApp; o cadastro pelo Instagram continua
 * exclusivo deste aviso, mesmo com o global ligado. */
export type RegisterDmOrder = { stage?: string | null; is_paid?: boolean | null; registered_at?: string | null } | null;
export type RegisterDmDecision = 'send' | 'skip_registered' | 'fail_closed_order';

export function registerDmDecision(order: RegisterDmOrder, _globalFollowupEnabled = false): RegisterDmDecision {
  if (!order || order.is_paid || ['cancelled', 'paid', 'completed', 'shipped'].includes(String(order.stage))) return 'fail_closed_order';
  if (order.registered_at) return 'skip_registered';
  return 'send';
}

/** O tipo F também responde ao comentário (Meta aceita só 1 resposta): não cria F se já há aviso de cadastro. */
export function followupFAllowed(registerDmStatuses: string[]): boolean {
  return !registerDmStatuses.some((s) => ['pending', 'processing', 'sent'].includes(s));
}
