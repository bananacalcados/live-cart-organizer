import { createClient } from 'npm:@supabase/supabase-js@2';
import { accessMetadata } from './access-log-data.ts';

export const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const normEmail = (v: unknown) => typeof v === 'string' ? v.trim().toLowerCase().slice(0, 254) : '';
export const validEmail = (e: string) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e);

/** País do IP (melhor esforço, 2 s). Falha → null, nunca bloqueia. */
export async function ipCountry(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  try {
    const ctl = AbortSignal.timeout(2000);
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code`, { signal: ctl });
    const j = await r.json();
    return j?.success ? String(j.country_code || '') || null : null;
  } catch { return null; }
}

/** Quantos eventos deste tipo na última hora com o filtro (ip ou e-mail em details). */
export async function countLastHour(db: ReturnType<typeof svc>, event: string, by: { ip?: string | null; email?: string }) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  let q = db.from('security_events').select('id', { count: 'exact', head: true }).eq('event', event).gte('created_at', since);
  if (by.ip) q = q.eq('ip', by.ip);
  if (by.email) q = q.eq('details->>email', by.email);
  const { count } = await q;
  return count ?? 0;
}

export function meta(req: Request) {
  const m = accessMetadata(req);
  return { ip: m.ip ?? null, ua: m.user_agent ?? null, origin: m.origin ?? null };
}
