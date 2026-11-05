import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { requireAuth } from '../_shared/requireAuth.ts';
import { backgroundLog, recordAuthEvent, withAccessLog } from '../_shared/withAccessLog.ts';

Deno.serve(withAccessLog('security-auth-event', async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{ headers:corsHeaders });
  const denied = await requireAuth(req);
  if (denied) return denied;
  if (req.method !== 'POST') return new Response('Method not allowed',{ status:405,headers:corsHeaders });
  const body = await req.json().catch(() => null);
  if (!body || !['login','logout'].includes(body.event)) return new Response('Invalid event',{ status:400,headers:corsHeaders });
  backgroundLog(recordAuthEvent(req,body.event));
  return new Response(JSON.stringify({ ok:true }),{ headers:{ ...corsHeaders,'Content-Type':'application/json' } });
}));