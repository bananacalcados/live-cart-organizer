import { z } from 'npm:zod@3';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const base = z.object({ token: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/), type: z.enum(['troca','devolucao']) });
const resolveSchema = base.extend({ item_id: z.string().uuid().optional(), search: z.string().trim().max(100).default(''), offset: z.number().int().min(0).max(10000).default(0) });
const submitSchema = base.extend({ item_id: z.string().uuid(), quantity: z.number().int().min(1).max(100), reason: z.enum(['tamanho','defeito','nao_gostou','produto_errado','outro']), detail: z.string().trim().min(3).max(1000), replacement_id: z.string().uuid().nullable().optional(), unused: z.boolean(), desired: z.string().trim().max(200).nullable().optional() });
type Db = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
export async function hashCentralToken(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join('');
}
/** Dependency injection lets tests exercise handlers without providers or production writes. */
export type CentralLimiter = (keys: string[], fail: boolean) => Promise<boolean>;
const GENERIC = 'Este link não está disponível. Peça um novo link à equipe.';
const BUSY = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
export function clientIp(req: Request) {
  return (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim().slice(0,64);
}
/** IP/token attempt counters in the database; any failure of the limiter itself fails closed. */
export function dbLimiter(db: Db): CentralLimiter {
  return async (keys, fail) => {
    const { data, error } = await db.rpc('central_rate_guard', { p_keys: keys, p_fail: fail });
    return !error && data === true;
  };
}
/** Public flag lives in support_settings.central_public_enabled; read errors keep the central closed. */
export function settingsFlag(db: { from: (t: string) => any }) {
  return async () => {
    const { data, error } = await db.from('support_settings').select('central_public_enabled').eq('id', true).maybeSingle();
    return !error && data?.central_public_enabled === true;
  };
}
export function centralHandler(kind: 'resolve' | 'submit', db: Db, enabled: () => Promise<boolean>, limiter: CentralLimiter = dbLimiter(db)) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return response({ error: 'Solicitação inválida.' },405);
    try {
      if (Number(req.headers.get('content-length') || 0)>6000) return response({ error: 'Solicitação inválida.' },400);
      // Closed by flag: answer before touching tokens or counters.
      if (!await enabled()) return response({ error: 'A central está em preparação. Fale com a nossa equipe.' },503);
      const ipKey = 'ip:' + await hashCentralToken('central-ip:' + clientIp(req));
      const raw = await req.json().catch(() => null);
      const parsed = (kind==='resolve' ? resolveSchema : submitSchema).safeParse(raw);
      if (!parsed.success) {
        const ok = await limiter([ipKey], true);
        return ok ? response({ error: GENERIC },400) : response({ error: BUSY },429);
      }
      const body = parsed.data;
      const hash = await hashCentralToken(body.token);
      const keys = [ipKey, 'tk:' + hash];
      if (!await limiter(keys, false)) return response({ error: BUSY },429);
      let name = 'central_context';
      const args: Record<string, unknown> = { p_hash: hash, p_type: body.type };
      if (kind==='submit') {
        const s = submitSchema.parse(body);
        if (s.type==='devolucao' && s.replacement_id) return response({ error: 'Devolução não tem escolha de produto novo.' },400);
        name='central_submit_atomic';
        Object.assign(args,{ p_item:s.item_id,p_quantity:s.quantity,p_reason:s.reason,p_detail:s.detail,p_replacement:s.replacement_id ?? null,p_unused:s.unused,p_desired:s.type==='troca' ? (s.desired || null) : null });
        // O banco decide pelo interruptor central_require_product_choice: desligado ignora replacement_id e escala.
      } else {
        const r=resolveSchema.parse(body);
        if (r.item_id) { name='central_options'; Object.assign(args,{ p_item:r.item_id,p_search:r.search,p_limit:50,p_offset:r.offset }); }
      }
      const { data,error } = await db.rpc(name,args);
      if (error) return response({ error:'Não foi possível concluir agora. Tente novamente mais tarde.' },500);
      if (!data) {
        // Same answer for missing, expired, revoked or wrong-type links; counts as an invalid attempt.
        const ok = await limiter(keys, true);
        return ok ? response({ error: GENERIC },404) : response({ error: BUSY },429);
      }
      return response(data,data.error ? 400 : 200);
    } catch { return response({ error:'Solicitação inválida.' },400); }
  };
}