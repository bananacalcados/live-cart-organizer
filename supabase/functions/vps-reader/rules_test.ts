import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { VPS_READER_ALLOWLIST, VPS_READER_EXCLUDED } from '../_shared/vps-reader-allowlist.ts';
import { clampLimit, clientIp, constantTimeEqual, matchKey, safeCursor, safeSince, sha256Hex, tableConfig } from '../_shared/vps-reader-rules.ts';

const SENSITIVE = /(^|_)(token|secret|password|api_key|apikey|client_secret)(_|$)|token_hash|password_hash|certificate_path|keys_auth/;
const COUNTS = new Set(['tokens_in','tokens_out','input_tokens','output_tokens','reservation_tokens','tokens','ai_daily_token_budget','token_expires_at']);

Deno.test('nenhuma coluna sensível sai pela porta', () => {
  for (const [t, c] of Object.entries(VPS_READER_ALLOWLIST))
    for (const col of c.columns) assert(!SENSITIVE.test(col) || col.startsWith('has_') || COUNTS.has(col), `${t}.${col}`);
});
Deno.test('tabelas de credenciais e app_settings ficam fora', () => {
  for (const t of ['app_settings','mercadopago_accounts','appmax_installations','correios_settings','dispatch_links','vps_reader_keys','vps_reader_audit','internal_function_secrets'])
    assertEquals(tableConfig(t), null, t);
  assert('app_settings' in VPS_READER_EXCLUDED);
});
Deno.test('whatsapp_numbers sem tokens', () => {
  const cols = VPS_READER_ALLOWLIST.whatsapp_numbers.columns;
  for (const c of ['access_token','zapi_token','uazapi_token','wasender_api_key','wasender_webhook_secret']) assert(!cols.includes(c));
});
Deno.test('nunca usa * e sempre tem chave', () => {
  for (const c of Object.values(VPS_READER_ALLOWLIST)) { assert(!c.columns.includes('*')); assert(c.columns.includes(c.pk)); }
});
Deno.test('tabela desconhecida e nomes de protótipo recusados', () => {
  assertEquals(tableConfig('nao_existe'), null); assertEquals(tableConfig('constructor'), null); assertEquals(tableConfig(null), null);
});
Deno.test('limite acima do teto é cortado', () => {
  assertEquals(clampLimit('orders', '9999'), 500); assertEquals(clampLimit('whatsapp_messages', '9999'), 200); assertEquals(clampLimit('orders', null), 200);
});
Deno.test('cursor e data não deixam injetar filtro', () => {
  assertEquals(safeCursor('abc,id.gt.0'), undefined); assertEquals(safeCursor('a)b'), undefined); assertEquals(safeCursor(''), null);
  assertEquals(safeCursor('0b6c-11'), '0b6c-11');
  assertEquals(safeSince('2026-11-01T00:00:00Z'), '2026-11-01T00:00:00.000Z'); assertEquals(safeSince('2026-11-01,or'), undefined);
});
Deno.test('IP vem do primeiro item validado de x-forwarded-for', () => {
  assertEquals(clientIp(new Headers({ 'x-forwarded-for': '189.24.13.236, 10.0.0.1' })), '189.24.13.236');
  assertEquals(clientIp(new Headers({ 'cf-connecting-ip': '189.24.13.236' })), '');
  assertEquals(clientIp(new Headers({ 'x-forwarded-for': 'lixo<script>' })), '');
  assertEquals(clientIp(new Headers({ 'x-forwarded-for': '189.24.13.236', 'cf-connecting-ip': '1.2.3.4' })), '');
});
Deno.test('chave por hash em tempo constante, várias ativas', async () => {
  const h = await sha256Hex('k'.repeat(40));
  assertEquals(matchKey(h, [{ id: 'a', key_hash: '0'.repeat(64) }, { id: 'b', key_hash: h }]), 'b');
  assertEquals(matchKey(h, []), null); assert(!constantTimeEqual('ab', 'abc'));
});
Deno.test('código da porta não tem caminho de escrita', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  const code = src.replace(/\/\/.*$/gm, '');
  for (const m of ['.insert(', '.update(', '.delete(', '.upsert(', 'execute_sql']) assert(!code.includes(m), m);
  const rpcs = [...code.matchAll(/\.rpc\('([a-z_]+)'/g)].map((x) => x[1]);
  assertEquals([...new Set(rpcs)].sort(), ['vps_reader_audit_log', 'vps_reader_guard_hit']);
});
