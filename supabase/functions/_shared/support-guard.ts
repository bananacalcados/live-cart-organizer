// Saúde do suporte automático: avisos, volta automática da sombra e regras de nova tentativa.
// Toda decisão de trava fica no banco (support_outbox_failure_pause / support_channel_pauses);
// aqui só há regras puras + a rotina chamada pelo cron já existente (sem cron novo).
import { internalCallHeaders } from './requireAuth.ts';
import { supportOutboxFunction } from './support-outbox.ts';
import { budgetAlertLevel } from './support-cost.ts';

export const RECOVER_AFTER_MS = 30 * 60_000;
export const ALERT_MIN_INTERVAL_MS = 30 * 60_000;

/** Erro de plataforma (HTML/5xx/rede) — a função de envio nem respondeu JSON. */
export function isTransientSendError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /Unexpected token '<'|<html|sem JSON|HTTP 50[234]|HTTP 546|WORKER_LIMIT|timed? ?out|ECONNRESET|connection (reset|closed)|network/i.test(error);
}

/** NF/Correios/histórico exigem decisão humana; falha de envio e triagem podem voltar sozinhas. */
export function shadowAutoRecoverable(reason: string | null | undefined): boolean {
  if (!reason) return false;
  if (reason.startsWith('Erros técnicos repetidos na reversa da Central')) return true;
  return !/reversa|NF|nota|Correios|histórico|colocar a mensagem da reversa/i.test(reason);
}

export type GuardStatus = {
  mode: string; shadow_auto: boolean; shadow_reason: string | null; shadow_at: string | null;
  paused: { id: string; name: string; provider?: string; until: string; reason: string }[];
  triage_total: number; triage_failed: number; alert_configured: boolean;
  alert_state: string | null; alert_last_sent_at: string | null;
  alert_phone?: string | null; alert_whatsapp_number_id?: string | null;
};

export function triageUnhealthy(s: Pick<GuardStatus, 'triage_total' | 'triage_failed'>) {
  return s.triage_total >= 4 && s.triage_failed * 2 > s.triage_total;
}

export function guardIssues(s: GuardStatus): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  if (s.mode === 'shadow' && s.shadow_auto) out.push({ key: 'shadow', text: `Modo automático PAUSADO (geral): ${String(s.shadow_reason || 'motivo não informado').slice(0, 160)}` });
  for (const p of s.paused) out.push({ key: `canal:${p.id}`, text: `Canal ${p.name} pausado até ${new Date(p.until).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}: ${String(p.reason).slice(0, 120)}` });
  if (triageUnhealthy(s)) out.push({ key: 'triagem', text: `Triagem da IA falhando: ${s.triage_failed} de ${s.triage_total} em 15 min` });
  return out;
}

export function guardStateKey(issues: { key: string }[]) {
  return issues.map((i) => i.key).sort().join('|');
}

/** Decide o que a rotina faz neste minuto. Pura, para testes. */
export function planGuardTick(s: GuardStatus, now = Date.now()) {
  const issues = guardIssues(s);
  const state = guardStateKey(issues);
  const shadowAt = s.shadow_at ? Date.parse(s.shadow_at) : NaN;
  const tryRecover = s.mode === 'shadow' && s.shadow_auto && shadowAutoRecoverable(s.shadow_reason)
    && Number.isFinite(shadowAt) && now - shadowAt >= RECOVER_AFTER_MS && !triageUnhealthy(s) && s.alert_configured;
  const prev = s.alert_state || '';
  const last = s.alert_last_sent_at ? Date.parse(s.alert_last_sent_at) : 0;
  let alert: 'problem' | 'normal' | null = null;
  if (state !== prev && !tryRecover) {
    if (state && now - last >= ALERT_MIN_INTERVAL_MS) alert = 'problem';
    else if (!state && prev) alert = 'normal';
  }
  return { issues, state, tryRecover, alert };
}

async function sendAlert(supabase: any, s: GuardStatus, text: string): Promise<boolean> {
  if (!s.alert_phone || !s.alert_whatsapp_number_id) return false;
  const { data: n } = await supabase.from('whatsapp_numbers').select('provider,is_active').eq('id', s.alert_whatsapp_number_id).maybeSingle();
  const fn = n?.is_active ? supportOutboxFunction(n.provider) : null;
  if (!fn || n.provider === 'instagram') return false;
  const res = await supabase.functions.invoke(fn, {
    body: { phone: s.alert_phone, message: text, whatsapp_number_id: s.alert_whatsapp_number_id },
    headers: { ...(await internalCallHeaders()), 'x-force-instance': 'true' },
  });
  return !res.error && !(res.data?.error || res.data?.success === false);
}

/** Alerta do teto diário: 1 por dia por faixa (80%/100%), reservado no banco antes de enviar. */
export async function notifyBudget(supabase: any, s?: any): Promise<{ level: 80 | 100 | null; sent: boolean }> {
  if (!s) { const r = await supabase.rpc('support_guard_status'); s = r.data; }
  const level = s ? budgetAlertLevel(Number(s.budget_used ?? 0), Number(s.budget_limit ?? 0)) : null;
  if (!level) return { level: null, sent: false };
  const { data: claimed } = await supabase.rpc('support_budget_alert_claim', { p_level: level });
  if (!claimed) return { level, sent: false };
  const pct = Math.round((Number(s.budget_used) / Number(s.budget_limit)) * 100);
  const text = level === 100
    ? `🛑 Suporte automático: teto diário atingido (${Number(s.budget_used).toLocaleString('pt-BR')} de ${Number(s.budget_limit).toLocaleString('pt-BR')} tokens). Novas mensagens vão para Em suporte até a meia-noite (Brasília).`
    : `⚠️ Suporte automático: IA já usou ${pct}% do teto diário (${Number(s.budget_used).toLocaleString('pt-BR')} de ${Number(s.budget_limit).toLocaleString('pt-BR')} tokens).`;
  return { level, sent: await sendAlert(supabase, s, text) };
}

export async function runSupportGuardTick(supabase: any, now = Date.now()) {
  const { data: s, error } = await supabase.rpc('support_guard_status');
  if (error || !s) return { ok: false, error: error?.message };
  try { await notifyBudget(supabase, s); } catch (e) { console.error('support-budget-alert', (e as Error).message); }
  const plan = planGuardTick(s as GuardStatus, now);
  if (plan.tryRecover) {
    // O envio interno de teste para o número de alerta é a prova de que o canal de saída funciona.
    const ok = await sendAlert(supabase, s, '✅ Suporte automático: teste interno OK, voltando para o modo automático.');
    if (ok) {
      const { data: done } = await supabase.rpc('support_guard_recover', { p_expected_shadow_at: s.shadow_at });
      const rest = guardIssues({ ...s, mode: 'auto' });
      await supabase.rpc('support_guard_mark_alert', { p_state: guardStateKey(rest) });
      return { ok: true, recovered: !!done };
    }
    return { ok: true, recovered: false, test: 'failed' };
  }
  if (plan.alert) {
    const text = plan.alert === 'problem'
      ? `⚠️ Suporte automático:\n${plan.issues.map((i) => `• ${i.text}`).join('\n')}`.slice(0, 900)
      : '✅ Suporte automático normalizado: todos os canais voltaram.';
    const sent = await sendAlert(supabase, s, text);
    // Sem número configurado: registra o estado para não insistir, o aviso fixo na tela continua.
    if (sent || !s.alert_configured) await supabase.rpc('support_guard_mark_alert', { p_state: plan.state });
    return { ok: true, alert: plan.alert, sent };
  }
  return { ok: true };
}
