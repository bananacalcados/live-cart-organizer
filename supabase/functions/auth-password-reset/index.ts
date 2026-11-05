import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { countLastHour, ipCountry, meta, normEmail, svc, validEmail } from '../_shared/auth-security.ts';

const GENERIC = { ok: true, message: 'Se o e-mail existir, enviaremos instruções para redefinir a senha.' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const ALLOWED_REDIRECT = /^https:\/\/(checkout\.bananacalcados\.com\.br|live-cart-organizer\.lovable\.app|[a-z0-9-]+\.lovable\.app)\/reset-password$/;

Deno.serve(withAccessLog('auth-password-reset', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await req.json().catch(() => null);
  const email = normEmail(body?.email);
  if (!validEmail(email)) return json(GENERIC); // mesma resposta, sem dica
  const { ip, ua, origin } = meta(req);
  const db = svc();

  const [byIp, byEmail] = await Promise.all([
    countLastHour(db, 'password_reset_requested', { ip }),
    countLastHour(db, 'password_reset_requested', { email }),
  ]);
  const limited = byIp >= 3 || byEmail >= 2;

  // Conta existe? (só para o alerta; nunca vai na resposta)
  let userId: string | null = null; let lastSignIn: string | null = null;
  try {
    const { data } = await db.rpc('security_user_by_email', { p_email: email });
    const row = Array.isArray(data) ? data[0] : data;
    if (row) { userId = row.id; lastSignIn = row.last_sign_in_at; }
  } catch { /* sem bloqueio */ }
  const country = await ipCountry(ip);
  const staleDays = lastSignIn ? Math.floor((Date.now() - Date.parse(lastSignIn)) / 86400_000) : null;

  let sent = false;
  if (!limited && userId) {
    const redirect = typeof body?.redirect_to === 'string' && ALLOWED_REDIRECT.test(body.redirect_to)
      ? body.redirect_to : 'https://checkout.bananacalcados.com.br/reset-password';
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
    const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo: redirect });
    sent = !error;
  }

  await db.from('security_events').insert({
    event: 'password_reset_requested', ip, user_id: userId,
    details: {
      email, user_agent: ua, origin, country, account_exists: !!userId,
      last_sign_in_at: lastSignIn, stale_days: staleDays, rate_limited: limited, sent,
      alert: (country && country !== 'BR') || (staleDays !== null && staleDays > 60) || (userId && !lastSignIn) ? true : false,
    },
  });
  return json(GENERIC);
}));
