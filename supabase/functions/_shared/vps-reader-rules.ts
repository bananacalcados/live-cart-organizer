// Regras puras da porta de leitura vps-reader (testáveis sem rede).
import { VPS_READER_ALLOWLIST } from './vps-reader-allowlist.ts';

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;
export const MESSAGE_MAX_LIMIT = 200;
const MESSAGE_TABLES = new Set(['whatsapp_messages', 'whatsapp_messages_archive', 'live_comments', 'webhook_events_raw']);

export function clampLimit(table: string, raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10);
  const max = MESSAGE_TABLES.has(table) ? MESSAGE_MAX_LIMIT : MAX_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return Math.min(DEFAULT_LIMIT, max);
  return Math.min(n, max);
}

// Cursor só com caracteres seguros (sem vírgula, parêntese, aspas) para não injetar filtros.
export function safeCursor(raw: string | null): string | null | undefined {
  if (raw === null || raw === '') return null;
  return /^[A-Za-z0-9_.:+\-]{1,200}$/.test(raw) ? raw : undefined;
}

export function safeSince(raw: string | null): string | null | undefined {
  if (raw === null || raw === '') return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9:.]+)?(Z|[+-][0-9]{2}:?[0-9]{2})?$/.test(raw)) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function tableConfig(name: string | null) {
  if (!name || !Object.prototype.hasOwnProperty.call(VPS_READER_ALLOWLIST, name)) return null;
  return VPS_READER_ALLOWLIST[name];
}

// IP de origem (conferido em teste real, 24/11/2026): o gateway do backend REESCREVE x-forwarded-for
// (o 1º item é a conexão real) e grava cf-connecting-ip; x-forwarded-for/x-real-ip enviados pelo cliente
// são descartados e cf-connecting-ip forjado é recusado pelo Cloudflare (403). Exigimos que os dois concordem.
export function clientIp(headers: Headers): string {
  const chain = headers.get('x-forwarded-for') ?? '';
  const first = chain.split(',')[0]?.trim() ?? '';
  const cf = headers.get('cf-connecting-ip')?.trim() ?? '';
  if (cf && cf !== first) return '';
  return /^[0-9a-fA-F:.]{3,64}$/.test(first) ? first : '';
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Compara com TODOS os hashes ativos, sem sair cedo.
export function matchKey(providedHash: string, keys: { id: string; key_hash: string }[]): string | null {
  let found: string | null = null;
  for (const k of keys) if (constantTimeEqual(providedHash, k.key_hash) && !found) found = k.id;
  return found;
}
