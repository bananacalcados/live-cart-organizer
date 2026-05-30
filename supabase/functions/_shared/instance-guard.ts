// Shared guard: blocks a send when the requested whatsapp_number_id does not
// match the instance of the last incoming message for that phone.
// Allow override via header X-Force-Instance: true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface InstanceGuardResult {
  ok: boolean;
  /** When !ok, the JSON body to return with 409. */
  body?: Record<string, unknown>;
}

export async function checkInstanceGuard(params: {
  req: Request;
  phone: string;
  whatsappNumberId?: string | null;
  supabaseUrl?: string;
  supabaseKey?: string;
}): Promise<InstanceGuardResult> {
  const { req, phone, whatsappNumberId } = params;
  if (!whatsappNumberId) return { ok: true };
  if (req.headers.get('x-force-instance') === 'true') return { ok: true };

  const supabaseUrl = params.supabaseUrl || Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = params.supabaseKey || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const phoneDigits = (phone || '').replace(/\D/g, '');
  if (!phoneDigits) return { ok: true };
  const variants = new Set<string>([phoneDigits]);
  if (phoneDigits.startsWith('55') && phoneDigits.length >= 12) variants.add(phoneDigits.slice(2));
  else variants.add('55' + phoneDigits);

  // Conversations are independent per (phone + instance). If the REQUESTED
  // instance already has incoming history with this phone, it's a legitimate
  // dedicated chat — always allow. We must NOT compare against the globally
  // latest incoming across instances, because the same phone can have separate
  // conversations on different instances.
  const { data: ownIncoming } = await supabase
    .from('whatsapp_messages')
    .select('id')
    .in('phone', [...variants])
    .eq('direction', 'incoming')
    .eq('whatsapp_number_id', whatsappNumberId)
    .limit(1)
    .maybeSingle();

  if (ownIncoming) return { ok: true };

  // No incoming on the requested instance. Only block if another instance HAS
  // received from this phone (operator is starting on the wrong instance).
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('whatsapp_number_id')
    .in('phone', [...variants])
    .eq('direction', 'incoming')
    .not('whatsapp_number_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const boundId = (data as any)?.whatsapp_number_id as string | undefined;
  if (boundId && boundId !== whatsappNumberId) {
    console.warn('[instance-guard] BLOCKED', { phone, requested: whatsappNumberId, bound: boundId });
    return {
      ok: false,
      body: {
        error: 'INSTANCE_MISMATCH',
        message:
          'A instância requisitada não corresponde à instância da última mensagem recebida desse contato.',
        requested_instance: whatsappNumberId,
        bound_instance: boundId,
      },
    };
  }
  return { ok: true };
}
