import { internalCallHeaders } from './requireAuth.ts';
import { isTransientSendError } from './support-guard.ts';

const RETRY_WAITS_MS = [3_000, 8_000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const SUPPORT_OUTBOX_INSTANCES = [
  '0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c',
  'ae453235-50e1-4ef6-8a87-8c8a77b2b440',
  '1f715932-e118-4e88-8051-85a5c14f5a4b',
  'c01d2777-df4c-4746-9433-d8c97c57d529',
  '531883b0-b8bc-48b9-a094-edb04a7a0478',
] as const;

export function supportOutboxPreflight(input: {
  instanceId: string; provider: string; phone: string; text: string; link?: string | null;
  incomingAt?: string | null; sentLastHour: number; now?: number;
}) {
  if (!SUPPORT_OUTBOX_INSTANCES.includes(input.instanceId as any)) return 'Instância não permitida para o assistente';
  const digits = String(input.phone || '').replace(/\D/g, '');
  if (input.provider === 'instagram' ? (digits.length < 5 || digits.length > 20) : (digits.length < 10 || digits.length > 13)) return 'Telefone inválido';
  const full = input.text + (input.link ? `\n${input.link}` : '');
  if (!input.text.trim() || full.length > 1000) return 'A mensagem deve ter de 1 a 1.000 caracteres';
  if (input.sentLastHour >= 30) return 'Limite de 30 envios por hora atingido';
  if (input.provider === 'meta' || input.provider === 'instagram') {
    const incoming = input.incomingAt ? Date.parse(input.incomingAt) : NaN;
    const now = input.now ?? Date.now();
    if (!Number.isFinite(incoming) || incoming > now + 5 * 60_000 || now - incoming > 24 * 3_600_000) {
      return 'Fora da janela de 24 horas da Meta';
    }
  }
  return null;
}

export function supportOutboxFunction(provider: string) {
  return provider === 'meta' ? 'meta-whatsapp-send'
    : provider === 'instagram' ? 'meta-messenger-send'
    : provider === 'uazapi' ? 'uazapi-send-message'
    : provider === 'wasender' ? 'wasender-send-message'
    : provider === 'zapi' ? 'zapi-send-message'
    : null;
}

async function invokeError(error: any) {
  if (!error) return null;
  try {
    const raw = await error.context?.text?.();
    if (raw) return raw.slice(0, 1000);
  } catch { /* usa a mensagem genérica abaixo */ }
  return String(error.message || error).slice(0, 1000);
}

/** O claim SQL valida janela, instâncias, pausa por canal e 30/hora atomicamente. */
export async function processSupportOutbox(supabase: any, opts: { wait?: (ms: number) => Promise<void> } = {}) {
  const wait = opts.wait ?? sleep;
  const { data: jobs, error } = await supabase.rpc('support_outbox_claim', { p_limit: 30 });
  if (error) throw new Error(error.message || 'Não foi possível reservar a caixa de saída');
  const rows = jobs || [];
  if (!rows.length) return { sent: 0, failed: 0, total: 0 };

  const ids = [...new Set(rows.map((r: any) => r.whatsapp_number_id))];
  const { data: numbers, error: numberError } = await supabase.from('whatsapp_numbers').select('id,provider,is_active').in('id', ids);
  if (numberError) throw new Error(numberError.message);
  const providers = new Map<string, any>((numbers || []).map((n: any) => [n.id, n] as [string, any]));
  let sent = 0, failed = 0;

  const skipped = new Set<string>();
  for (const [jobIndex, job] of rows.entries()) {
    if (skipped.has(job.whatsapp_number_id)) continue;
    const instance = providers.get(job.whatsapp_number_id);
    const fn = instance?.is_active ? supportOutboxFunction(instance.provider) : null;
    const message = job.text + (job.link ? `\n${job.link}` : '');
    let providerMessageId: string | null = null;
    let sendError: string | null = fn ? null : 'Instância inativa ou provedor não suportado';
    let data: any = null;

    if (fn && message.length <= 1000) {
      // Instagram: até 3 tentativas só para erro de plataforma (HTML/5xx), e só se o histórico
      // confirmar que nada saiu (instagram-dm-send grava o envio ao concluir). WhatsApp não repete envio incerto.
      for (let attempt = 0; ; attempt++) {
        const res = await supabase.functions.invoke(fn, {
          body: instance.provider === 'instagram'
            ? { recipientId: job.phone, message, channel: 'instagram', whatsapp_number_id: job.whatsapp_number_id }
            : { phone: job.phone, message, whatsapp_number_id: job.whatsapp_number_id },
          headers: { ...(await internalCallHeaders()), 'x-force-instance': 'true' },
        });
        data = res.data;
        sendError = await invokeError(res.error);
        if (!sendError && (data?.error || data?.success === false)) sendError = JSON.stringify(data?.details ? { error: data.error, details: data.details } : (data.error || data)).slice(0, 1000);
        providerMessageId = data?.messageId ?? data?.data?.messages?.[0]?.id ?? data?.data?.messageid ?? null;
        if (!sendError || instance.provider !== 'instagram' || !isTransientSendError(sendError) || attempt >= RETRY_WAITS_MS.length) break;
        await wait(RETRY_WAITS_MS[attempt]);
        const { data: out } = await supabase.from('whatsapp_messages').select('message_id')
          .eq('phone', job.phone).eq('whatsapp_number_id', job.whatsapp_number_id).eq('direction', 'outgoing')
          .gte('created_at', job.claimed_at).limit(1);
        if (out?.length) { sendError = null; providerMessageId = out[0].message_id ?? null; break; }
        sendError = `${sendError} (tentativa ${attempt + 1} de 3)`;
      }
      if (sendError && instance.provider === 'instagram' && /tentativa/.test(sendError) === false && isTransientSendError(sendError)) sendError = `${sendError} (3 tentativas)`;
    } else if (!sendError) sendError = 'A mensagem com o link passa de 1.000 caracteres';

    if (!sendError) {
      const fullText = message;
      // instagram-dm-send já grava o envio com @/ID e janela validada; não duplicar o histórico.
      const historyError = instance.provider === 'instagram' ? null : (await supabase.from('whatsapp_messages').insert({
        phone: job.phone, message: fullText, direction: 'outgoing', status: 'sent',
        whatsapp_number_id: job.whatsapp_number_id, sender_name: 'Assistente do dono',
        ...(providerMessageId ? { message_id: String(providerMessageId) } : {}),
      })).error;
      await supabase.from('support_outbox').update({
        status: 'sent', sent_at: new Date().toISOString(), provider_message_id: providerMessageId ? String(providerMessageId) : null,
        error: historyError ? `Enviada, mas o histórico precisa de revisão: ${historyError.message}`.slice(0, 1000) : null,
      }).eq('id', job.id).eq('status', 'pending').eq('claimed_at', job.claimed_at);
      if (job.suggestion_id) await supabase.from('support_auto_suggestions').update({
        status: 'enviada', sent_at: new Date().toISOString(), sent_text: message, sent_link_id: job.link_id ?? null,
      }).eq('id', job.suggestion_id).eq('status', 'nova');
      sent++;
      if (historyError) {
        await supabase.rpc('support_emergency_pause', { p_reason: `Envio concluído, mas o histórico falhou: ${historyError.message}` });
        const remaining = rows.slice(jobIndex + 1).map((r: any) => r.id);
        if (remaining.length) await supabase.from('support_outbox').update({ claimed_at: null }).in('id', remaining).eq('status', 'pending');
        break;
      }
    } else {
      await supabase.from('support_outbox').update({ status: 'failed', error: String(sendError).slice(0, 1000) })
        .eq('id', job.id).eq('status', 'pending').eq('claimed_at', job.claimed_at);
      if (job.suggestion_id) await supabase.from('support_auto_suggestions').update({ status: 'nova', decision: 'fila', reason: 'erro_envio_automatico', auto_send_after: null }).eq('id', job.suggestion_id);
      // Falha isolada: o banco move a conversa para "Em suporte" e só pausa o canal com falhas repetidas.
      // Os demais envios do mesmo canal voltam para a fila (respeitando a pausa, se houver); outros canais seguem.
      const sameChannel = rows.slice(jobIndex + 1).filter((r: any) => r.whatsapp_number_id === job.whatsapp_number_id).map((r: any) => r.id);
      if (sameChannel.length) await supabase.from('support_outbox').update({ claimed_at: null }).in('id', sameChannel).eq('status', 'pending');
      skipped.add(job.whatsapp_number_id);
      failed++;
    }
  }
  return { sent, failed, total: rows.length };
}
