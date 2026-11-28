import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { timingSafeEqual, createHash } from 'node:crypto';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { authenticateCronRequest } from '../_shared/cron-auth.ts';
import { internalCallHeaders } from '../_shared/requireAuth.ts';
import { decideAlarm, pickAlarmSender, problems, publicHealth, type Health } from '../_shared/queue-alarm.ts';

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const sameSecret = (a: string, b: string) => { const h = (v: string) => createHash('sha256').update(v).digest(); return timingSafeEqual(h(a), h(b)); };

Deno.serve(withAccessLog('queue-health', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Vigia externo (VPS): GET somente leitura com segredo próprio; nenhum dado de cliente.
  if (req.method === 'GET') {
    const secret = Deno.env.get('QUEUE_WATCH_SECRET');
    if (!secret) return json({ error: 'not_configured' }, 503);
    const given = req.headers.get('x-queue-watch-secret') || '';
    if (!given || !sameSecret(given, secret)) return json({ error: 'unauthorized' }, 401);
    const h = await sb.rpc('queue_health', {});
    if (h.error) return json({ ok: false, error: 'health_unavailable' }, 500);
    return json(publicHealth(h.data as Health, Date.now()));
  }

  // Alarme: só pelo agendador gerenciado.
  const denied = authenticateCronRequest(req);
  if (denied) return denied;
  const h = await sb.rpc('queue_health', {});
  if (h.error) return json({ error: 'health_unavailable' }, 500);
  const health = h.data as Health;
  const now = Date.now();
  const found = problems(health, now);
  const [{ data: settings }, { data: open }] = await Promise.all([
    sb.from('queue_alert_settings').select('alert_phone,renotify_minutes').eq('id', true).maybeSingle(),
    sb.from('queue_alert_incidents').select('id,opened_at,last_notified_at,notify_count').is('closed_at', null).maybeSingle(),
  ]);
  const action = decideAlarm(found, open, now, settings?.renotify_minutes ?? 30);
  if (action.kind === 'none') return json({ ok: true, problems: found.length, action: 'none' });

  let incidentId = open?.id as string | undefined;
  if (action.kind === 'open') {
    const ins = await sb.from('queue_alert_incidents').insert({ summary: { problems: found } }).select('id').single();
    if (ins.error) return json({ ok: true, action: 'race' }); // outra execução abriu o incidente
    incidentId = ins.data.id;
  }
  // Envio direto pelo provedor (não passa por nenhuma fila) e por instância fora do problema.
  let sendError: string | null = null;
  if (settings?.alert_phone) {
    const { data: numbers } = await sb.from('whatsapp_numbers').select('id,provider,is_active,is_online').eq('is_active', true).limit(50);
    const sender = pickAlarmSender((numbers || []) as any, health);
    if (!sender) sendError = 'sem_instancia_livre';
    else {
      try {
        const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${sender.provider}-send-message`, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { ...(await internalCallHeaders()), 'Content-Type': 'application/json', 'x-force-instance': 'true' },
          body: JSON.stringify({ phone: settings.alert_phone, message: action.text, type: 'text', whatsapp_number_id: sender.id, linkPreview: false }),
        });
        if (!r.ok) sendError = `http_${r.status}`;
      } catch (e) { sendError = e instanceof Error ? e.message.slice(0, 120) : 'falha'; }
    }
  } else sendError = 'numero_nao_configurado';

  const nowIso = new Date().toISOString();
  if (action.kind === 'close') {
    await sb.from('queue_alert_incidents').update({ closed_at: nowIso, closed_notified: !sendError, last_send_error: sendError }).eq('id', incidentId);
  } else {
    await sb.from('queue_alert_incidents').update({ last_notified_at: nowIso, notify_count: (open?.notify_count || 0) + 1, summary: { problems: found }, last_send_error: sendError }).eq('id', incidentId);
  }
  return json({ ok: true, action: action.kind, problems: found.length, sent: !sendError });
}));
