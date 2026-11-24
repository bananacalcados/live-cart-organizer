// Porta de leitura para a VPS do dono. SOMENTE LEITURA.
// Ordem: método GET -> IP permitido -> limite/bloqueio -> chave por hash -> interruptor -> leitura.
// As únicas escritas são as duas RPCs internas de guarda e auditoria (nunca em tabelas de negócio).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { withAccessLog } from '../_shared/withAccessLog.ts';
import { VPS_READER_ALLOWLIST } from '../_shared/vps-reader-allowlist.ts';
import { clampLimit, clientIp, matchKey, safeCursor, safeSince, sha256Hex, tableConfig } from '../_shared/vps-reader-rules.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const JSON_H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const DEADLINE_MS = 8000;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_H });
const refuse = () => new Response(null, { status: 401, headers: JSON_H });

function ipHeaders(h: Headers) {
  const pick = (n: string) => h.get(n)?.slice(0, 200) ?? null;
  return { xff: pick('x-forwarded-for'), cf: pick('cf-connecting-ip'), real: pick('x-real-ip') };
}

async function audit(ip: string, h: Headers, op: string | null, table: string | null, rows: number | null, started: number, status: string, keyId: string | null) {
  try {
    await sb.rpc('vps_reader_audit_log', {
      p_ip: ip || 'unknown', p_ip_headers: ipHeaders(h), p_op: op, p_table: table, p_rows: rows,
      p_ms: Math.round(performance.now() - started), p_status: status, p_key_id: keyId,
    });
  } catch { console.error('[vps-reader] audit unavailable'); }
}

Deno.serve(withAccessLog('vps-reader', async (req) => {
  const started = performance.now();
  const url = new URL(req.url);
  const op = url.searchParams.get('op');
  const tableName = url.searchParams.get('table');
  const ip = clientIp(req.headers);
  if (req.method !== 'GET') { await audit(ip, req.headers, op, tableName, null, started, 'method', null); return refuse(); }

  const { data: ipRow } = await sb.from('vps_reader_allowed_ips').select('ip').eq('ip', ip || '-').eq('active', true).maybeSingle();
  if (!ipRow) { await audit(ip, req.headers, op, tableName, null, started, 'ip_denied', null); return refuse(); }

  const provided = req.headers.get('x-vps-reader-key') ?? '';
  let keyId: string | null = null;
  if (provided.length >= 32 && provided.length <= 512) {
    const { data: keys } = await sb.from('vps_reader_keys').select('id, key_hash').eq('active', true).is('revoked_at', null).limit(20);
    keyId = matchKey(await sha256Hex(provided), keys ?? []);
  }
  const { data: guard } = await sb.rpc('vps_reader_guard_hit', { p_ip: ip, p_bad: !keyId });
  if (!guard?.allowed) { await audit(ip, req.headers, op, tableName, null, started, `guard_${guard?.reason ?? 'error'}`, keyId); return new Response(null, { status: 429, headers: JSON_H }); }
  if (!keyId) { await audit(ip, req.headers, op, tableName, null, started, 'bad_key', null); return refuse(); }

  const { data: flag } = await sb.from('app_settings').select('value').eq('key', 'vps_reader_enabled').maybeSingle();
  if (flag?.value !== true) { await audit(ip, req.headers, op, tableName, null, started, 'disabled', keyId); return new Response(null, { status: 503, headers: JSON_H }); }

  const done = async (status: number, body: Record<string, unknown>, rows: number | null, tag: string) => {
    await audit(ip, req.headers, op, tableName, rows, started, tag, keyId);
    return json(status, { ...body, server_ms: Math.round(performance.now() - started) });
  };

  if (op === 'health') {
    const t0 = performance.now();
    const { error } = await sb.from('orders').select('id').order('id').limit(1);
    const t1 = performance.now();
    await sb.from('whatsapp_messages').select('id', { count: 'estimated', head: true }).limit(1);
    const t2 = performance.now();
    return done(error ? 500 : 200, { ok: !error, db_ping_ms: Math.round(t1 - t0), estimate_ms: Math.round(t2 - t1) }, 0, error ? 'health_error' : 'ok');
  }

  if (op === 'tables') {
    const tables = Object.entries(VPS_READER_ALLOWLIST).map(([name, c]) => ({ name, pk: c.pk, incremental: c.incremental, columns: c.columns }));
    return done(200, { tables }, tables.length, 'ok');
  }

  const cfg = tableConfig(tableName);
  if (!cfg || !tableName) return done(400, { error: 'table_not_allowed' }, 0, 'bad_table');
  const select = cfg.columns.join(',');

  if (op === 'count') {
    const since = safeSince(url.searchParams.get('since'));
    if (since === undefined) return done(400, { error: 'bad_since' }, 0, 'bad_param');
    if (since && !cfg.incremental) return done(400, { error: 'no_incremental' }, 0, 'bad_param');
    const mode = url.searchParams.get('mode') === 'estimate' ? 'estimated' : 'exact';
    let q = sb.from(tableName).select(cfg.pk, { count: mode, head: true });
    if (since && cfg.incremental) q = q.gte(cfg.incremental, since);
    const { count, error } = await q;
    if (error) return done(500, { error: 'count_failed' }, 0, 'db_error');
    return done(200, { table: tableName, count, mode }, 0, 'ok');
  }

  const cursor = safeCursor(url.searchParams.get('cursor'));
  if (cursor === undefined) return done(400, { error: 'bad_cursor' }, 0, 'bad_param');
  const limit = clampLimit(tableName, url.searchParams.get('limit'));

  if (op === 'read') {
    let q = sb.from(tableName).select(select).order(cfg.pk, { ascending: true }).limit(limit);
    if (cursor) q = q.gt(cfg.pk, cursor);
    const { data, error } = await q;
    if (error) return done(500, { error: 'read_failed' }, 0, 'db_error');
    const rows = (data ?? []) as Record<string, unknown>[];
    const hasMore = rows.length === limit;
    return done(200, { table: tableName, rows, next_cursor: hasMore ? String(rows[rows.length - 1][cfg.pk]) : null, has_more: hasMore,
      timed_out: performance.now() - started > DEADLINE_MS }, rows.length, 'ok');
  }

  if (op === 'changes') {
    if (!cfg.incremental) return done(400, { error: 'no_incremental' }, 0, 'bad_param');
    const since = safeSince(url.searchParams.get('since'));
    if (!since) return done(400, { error: 'bad_since' }, 0, 'bad_param');
    const col = cfg.incremental;
    let q = sb.from(tableName).select(select).order(col, { ascending: true }).order(cfg.pk, { ascending: true }).limit(limit);
    q = cursor ? q.or(`${col}.gt.${since},and(${col}.eq.${since},${cfg.pk}.gt.${cursor})`) : q.gte(col, since);
    const { data, error } = await q;
    if (error) return done(500, { error: 'read_failed' }, 0, 'db_error');
    const rows = (data ?? []) as Record<string, unknown>[];
    const hasMore = rows.length === limit;
    const last = rows[rows.length - 1];
    return done(200, { table: tableName, rows, has_more: hasMore,
      next_since: hasMore ? new Date(String(last[col])).toISOString() : null,
      next_cursor: hasMore ? String(last[cfg.pk]) : null }, rows.length, 'ok');
  }

  return done(400, { error: 'unknown_op' }, 0, 'bad_op');
}));
