import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { requireAuth } from '../_shared/requireAuth.ts';
import { calculate } from './rules.ts';
import { evaluate } from './ai.ts';
import { sendRhCandidateNotice, sendRhTestNotice } from './notify.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(withAccessLog('rh-score', async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const denied = await requireAuth(req, [], true);
  if (denied) return denied;

  let body: any;
  try { body = await req.json(); } catch { return json({ message: 'Pedido inválido.' }, 400); }
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!service || !url) return json({ message: 'Serviço indisponível.' }, 503);
  const internal = req.headers.get('authorization') === `Bearer ${service}`;
  const sb = createClient(url, service, { auth: { persistSession: false } });
  const action = String(body?.action || '');

  // Ações manuais são somente admin JWT; chamadas internas não podem testar nem reenviar.
  if (action) {
    if (internal || !['notify', 'test'].includes(action)) return json({ message: 'Ação não permitida.' }, 403);
    if (action === 'test') {
      const result = await sendRhTestNotice(sb);
      return json(result, result.ok ? 200 : 409);
    }
    const id = String(body.candidato_id || '');
    if (!UUID.test(id)) return json({ message: 'Cadastro inválido.' }, 400);
    const result = await sendRhCandidateNotice(sb, id, true);
    return json(result, result.ok ? 200 : 409);
  }

  const id = String(body.candidato_id || '');
  if (!UUID.test(id)) return json({ message: 'Cadastro inválido.' }, 400);
  // O navegador nunca escolhe modo automático nem injeta entradas/falhas da avaliação.
  const manual = !internal;
  const { data: input, error } = await sb.rpc('rh_score_claim', { p_id: id, p_manual: manual });
  if (error) return json({ message: 'Não foi possível iniciar a avaliação.' }, 500);
  if (!input?.ok) return json({ message: input?.message }, 409);

  let ai = null;
  let err: string | null = null;
  try {
    if (input.settings.ai_blocked_reason) throw new Error(input.settings.ai_blocked_reason);
    ai = await evaluate(input);
  } catch (e) {
    err = e instanceof Error ? e.message : 'Avaliação indisponível.';
    const status = (e as any).status;
    if (status === 402 || status === 403) await sb.from('rh_settings').update({ ai_blocked_reason: err }).eq('id', 1);
  }
  const result = calculate(input, ai, err);
  const { data: saved, error: saveError } = await sb.rpc('rh_score_finish', { p_id: id, p_token: input.token, p_result: result });
  if (saveError || !saved) return json({ message: 'Não foi possível salvar a avaliação.' }, 500);

  // A avaliação já está salva: uma falha de WhatsApp nunca desfaz nem esconde a nota.
  // Reavaliação manual não dispara aviso automático; reenvio tem botão próprio.
  if (!manual) {
    try { await sendRhCandidateNotice(sb, id, false); }
    catch (noticeError) { console.error('RH notice failed after saved evaluation', noticeError); }
  }
  return json({ ok: true, ...result });
}));
