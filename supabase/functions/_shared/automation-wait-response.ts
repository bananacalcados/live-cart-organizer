import { replyTarget } from "./automation-reply-branches.ts";

/** Resume only explicit waits, on the receiving instance, once and before expiry. */
export async function resumeAutomationWait(supabase: any, phone: string, numberId: string | null | undefined): Promise<boolean> {
  if (!numberId) return false;
  const digits = phone.replace(/\D/g, '');
  const variants = new Set([phone, digits]);
  if (digits.startsWith('55') && digits.length >= 12) variants.add(digits.slice(2));
  if (!digits.startsWith('55') && digits.length >= 10) variants.add('55' + digits);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('automation_pending_replies')
    .select('id,phone,flow_id,pending_step_index,button_branches,whatsapp_number_id,recipient_data')
    .in('phone', [...variants]).eq('whatsapp_number_id', numberId)
    .eq('is_active', true).gt('expires_at', now)
    .contains('button_branches', { __wait_reply__: 'true' })
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const { data: claimed, error: claimError } = await supabase.from('automation_pending_replies')
    .update({ is_active: false, answered_at: now }).eq('id', data.id)
    .eq('is_active', true).gt('expires_at', new Date().toISOString())
    .select('id').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return true;
  const target = replyTarget(data.button_branches || {}, false, '');
  if (!target) return true;
  const { data: steps, error: stepsError } = await supabase.from('automation_steps')
    .select('id,step_order').eq('flow_id', data.flow_id).order('step_order').limit(200);
  if (stepsError) throw stepsError;
  const start = (steps || []).findIndex((step: { id: string }) => step.id === target);
  if (start < 0) return true;
  const { error: continuationError } = await supabase.functions.invoke('automation-continue-flow', { body: {
    flowId: data.flow_id, phone: data.phone, startFromStep: start,
    recipientData: data.recipient_data, whatsappNumberId: data.whatsapp_number_id,
  } });
  if (continuationError) throw continuationError;
  return true;
}
