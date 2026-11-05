import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { logClient, verifiedIdentity } from './withAccessLog.ts';
import { internalCredentialsMatch } from './access-log-data.ts';

let internalSecret: string | null = null;
export async function internalCallHeaders(): Promise<Record<string,string>> {
  if (!internalSecret) {
    internalSecret = Deno.env.get('INTERNAL_FN_SECRET') || null;
    if (!internalSecret) {
      const { data } = await logClient()?.from('internal_function_secrets').select('value').eq('key','cron_secret').maybeSingle() ?? { data: null };
      internalSecret = data?.value ?? null;
    }
  }
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!service || !internalSecret) throw new Error('Internal authentication unavailable');
  return { Authorization: `Bearer ${service}`, 'x-internal-call': internalSecret };
}

export async function requireAuth(req: Request, modules: string[] = [], adminOnly = false): Promise<Response | null> {
  const deny = (status: number) => new Response(JSON.stringify({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }), {
    status, headers: { ...corsHeaders, 'Content-Type':'application/json' },
  });
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim() || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (service && token === service) {
    try {
      const headers = await internalCallHeaders();
      return internalCredentialsMatch(token,req.headers.get('x-internal-call') || '',service,headers['x-internal-call']) ? null : deny(401);
    } catch { return deny(401); }
  }
  const identity = await verifiedIdentity(req);
  if (!identity) return deny(401);
  if (!adminOnly && modules.length === 0) return null;
  const sb = logClient();
  if (!sb) return deny(403);
  const { data: admin, error } = await sb.rpc('has_role',{ _user_id:identity.userId, _role:'admin' });
  if (error) return deny(403);
  if (admin === true) return null;
  if (!adminOnly) {
    const results = await Promise.all(modules.map(module => sb.rpc('has_module_access',{ _user_id:identity.userId,_module:module })));
    if (results.some(result => !result.error && result.data === true)) return null;
  }
  return deny(403);
}