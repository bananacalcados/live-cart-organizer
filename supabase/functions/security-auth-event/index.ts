import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { requireAuth } from '../_shared/requireAuth.ts';
import { backgroundLog, recordAuthEvent, verifiedIdentity, withAccessLog } from '../_shared/withAccessLog.ts';
import { countLastHour, ipCountry, meta, normEmail, svc, validEmail } from '../_shared/auth-security.ts';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(withAccessLog('security-auth-event', async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{ headers:corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed',{ status:405,headers:corsHeaders });
  const body = await req.json().catch(() => null);
  const event = body?.event;
  if (!['login','logout','login_ok','login_failed'].includes(event)) return new Response('Invalid event',{ status:400,headers:corsHeaders });

  if (event === 'login_failed') {
    // Sem sessão: declarado pelo navegador; limitado por IP para não virar spam.
    const { ip, ua, origin } = meta(req);
    const db = svc();
    if (await countLastHour(db, 'login_failed', { ip }) >= 30) return json({ ok: true });
    const email = normEmail(body?.email);
    await db.from('security_events').insert({ event: 'login_failed', ip, details: {
      email: validEmail(email) ? email : null, user_agent: ua, origin, country: await ipCountry(ip),
      reason: typeof body?.reason === 'string' ? body.reason.slice(0, 80) : null, declared_by: 'browser',
    } });
    return json({ ok: true });
  }

  const denied = await requireAuth(req);
  if (denied) return denied;
  if (event === 'login_ok') {
    const id = await verifiedIdentity(req);
    const { ip, ua, origin } = meta(req);
    await svc().from('security_events').insert({ event: 'login_ok', ip, user_id: id?.userId ?? null, details: {
      email: id?.email ?? null, user_agent: ua, origin, country: await ipCountry(ip), declared_by: 'browser',
    } });
    return json({ ok: true });
  }
  backgroundLog(recordAuthEvent(req,event));
  return json({ ok:true });
}));
