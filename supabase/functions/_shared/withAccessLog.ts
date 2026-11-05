import { createClient } from 'npm:@supabase/supabase-js@2';
import { accessMetadata, clipped, sensitiveAction } from './access-log-data.ts';

type Handler = (req: Request, info?: any) => Response | Promise<Response>;
type Identity = { userId: string; email: string | null; sessionId: string | null };
let client: ReturnType<typeof createClient> | undefined;
const identities = new WeakMap<Request, Promise<Identity | null>>();

export function logClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function verifiedIdentity(req: Request): Promise<Identity | null> {
  const existing = identities.get(req);
  if (existing) return existing;
  const pending = (async () => {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token || token === Deno.env.get('SUPABASE_ANON_KEY') || token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return null;
    const sb = logClient();
    if (!sb) return null;
    try {
      const { data, error } = await sb.auth.getClaims(token);
      const claims = data?.claims;
      if (error || claims?.role !== 'authenticated' || typeof claims.sub !== 'string') return null;
      return { userId: claims.sub, email: typeof claims.email === 'string' ? clipped(claims.email) : null,
        sessionId: typeof claims.session_id === 'string' ? clipped(claims.session_id) : null };
    } catch { return null; }
  })();
  identities.set(req, pending);
  return pending;
}

export function backgroundLog(task: Promise<unknown>) {
  const safe = task.catch(() => console.error('[access-log] persistence unavailable'));
  const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(safe);
}

export async function recordAuthEvent(req: Request, event: 'login' | 'logout') {
  const identity = await verifiedIdentity(req);
  const sb = logClient();
  if (!identity || !sb) return;
  const metadata = accessMetadata(req);
  const { error } = await sb.rpc('record_admin_access', {
    p_user_id: identity.userId, p_email: identity.email, p_event: event, p_module: 'auth',
    p_ip: metadata.ip, p_user_agent: metadata.user_agent,
  });
  if (error) throw new Error('auth log unavailable');
}

export function withAccessLog(name: string, handler: Handler): Handler {
  return async (req, info) => {
    if (req.method === 'OPTIONS') return handler(req, info);
    const started = performance.now();
    let status = 500;
    let reason: string | null = null;
    try {
      const response = await handler(req, info);
      status = response.status;
      reason = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 410 ? 'disabled' : null;
      return response;
    } catch (error) {
      reason = 'handler_exception';
      throw error;
    } finally {
      const duration = Math.round(performance.now() - started);
      backgroundLog((async () => {
        const sb = logClient();
        if (!sb) return;
        const identity = await verifiedIdentity(req);
        const metadata = accessMetadata(req);
        const { error } = await sb.from('access_log').insert({
          ...metadata, function_name: clipped(name), user_id: identity?.userId ?? null,
          user_email: identity?.email ?? null, session_id: identity?.sessionId ?? null,
          http_status: status, duration_ms: duration, blocked: [401,403,410].includes(status), reason,
        });
        if (error) throw new Error('access log unavailable');
        if (sensitiveAction(name)) {
          const { error: adminError } = await sb.rpc('record_admin_access', {
            p_user_id: identity?.userId ?? null, p_email: identity?.email ?? null,
            p_event: `${name}:${status}`, p_module: name.split('-')[0], p_ip: metadata.ip, p_user_agent: metadata.user_agent,
          });
          if (adminError) throw new Error('admin log unavailable');
        }
      })());
    }
  };
}