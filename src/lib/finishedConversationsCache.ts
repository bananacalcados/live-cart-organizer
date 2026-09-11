import { supabase } from "@/integrations/supabase/client";

/**
 * Cache compartilhado de conversas finalizadas (chat_finished_conversations).
 *
 * IMPORTANTE: a finalização é POR INSTÂNCIA. O mesmo telefone pode ter
 * conversas abertas em várias instâncias (Meta Centro, Whats Pérola, …) e
 * finalizar em uma NÃO pode finalizar as outras. Por isso a chave do cache é
 * `telefone(8 dígitos)|instância`.
 *
 * Registros antigos (gravados antes dessa mudança) não têm instância e valem
 * para todas — são guardados sob a instância "legado".
 */

const TTL_MS = 5 * 60 * 1000;
const CHUNK = 300;

/** Instância "legado"/curinga: vale para todas as instâncias. */
export const LEGACY_INSTANCE_KEY = "00000000-0000-0000-0000-000000000000";

export function finishedPhoneKey(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  return digits ? digits.slice(-8) : "";
}

export function instanceKeyOf(instanceId: string | null | undefined): string {
  return instanceId || LEGACY_INSTANCE_KEY;
}

export function finishedCacheKey(
  phone: string | null | undefined,
  instanceId: string | null | undefined,
): string {
  const p = finishedPhoneKey(phone);
  return p ? `${p}|${instanceKeyOf(instanceId)}` : "";
}

/** `phone8|instance` -> finishedAt */
const entries = new Map<string, string>();
/** phone8 -> timestamp da última resolução (freshness) */
const resolvedAt = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function isFresh(at: number | undefined) {
  return at !== undefined && Date.now() - at < TTL_MS;
}

// Notificação COALESCIDA: várias escritas seguidas viram UM único re-render.
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
function notify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    listeners.forEach((cb) => {
      try { cb(); } catch { /* noop */ }
    });
  }, 40);
}

export function subscribeFinishedCache(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Snapshot síncrono (chaves compostas telefone|instância). */
export function peekFinishedMap(): Map<string, string> {
  return new Map(entries);
}

/** Telefones já resolvidos (para re-resolução forçada). */
export function peekResolvedPhones(): string[] {
  return Array.from(resolvedAt.keys());
}

/**
 * Lê a data de finalização de uma conversa considerando a instância.
 * Um registro legado (sem instância) vale para qualquer instância.
 */
export function getFinishedAtFor(
  map: Map<string, string>,
  phone: string | null | undefined,
  instanceId: string | null | undefined,
): string | undefined {
  const p = finishedPhoneKey(phone);
  if (!p) return undefined;
  return map.get(`${p}|${instanceKeyOf(instanceId)}`) ?? map.get(`${p}|${LEGACY_INSTANCE_KEY}`);
}

/** Grava/atualiza uma entrada localmente (escrita otimista e realtime). */
export function setFinishedLocal(
  phone: string,
  instanceId: string | null | undefined,
  finishedAt: string | null,
) {
  const key = finishedCacheKey(phone, instanceId);
  if (!key) return;
  if (finishedAt) entries.set(key, finishedAt);
  else entries.delete(key);
  const p = finishedPhoneKey(phone);
  // Reabertura: registros legados também deixam de valer.
  if (!finishedAt) entries.delete(`${p}|${LEGACY_INSTANCE_KEY}`);
  resolvedAt.set(p, Date.now());
  notify();
}

/** Versão em lote de setFinishedLocal (uma única notificação). */
export function setFinishedLocalMany(
  items: { phone: string; instanceId?: string | null }[],
  finishedAt: string | null,
) {
  const now = Date.now();
  for (const item of items) {
    const key = finishedCacheKey(item.phone, item.instanceId);
    if (!key) continue;
    if (finishedAt) entries.set(key, finishedAt);
    else entries.delete(key);
    const p = finishedPhoneKey(item.phone);
    if (!finishedAt) entries.delete(`${p}|${LEGACY_INSTANCE_KEY}`);
    resolvedAt.set(p, now);
  }
  notify();
}

export function invalidateFinishedCache(phone?: string) {
  if (phone) {
    const p = finishedPhoneKey(phone);
    resolvedAt.delete(p);
    for (const key of Array.from(entries.keys())) {
      if (key.startsWith(`${p}|`)) entries.delete(key);
    }
  } else {
    entries.clear();
    resolvedAt.clear();
  }
  notify();
}

async function fetchChunk(keys: string[]): Promise<void> {
  const { data, error } = await (supabase as any).rpc("resolve_finished_conversations", {
    p_keys: keys,
  });
  if (error) {
    console.error("Erro ao resolver conversas finalizadas:", error);
    return;
  }
  const now = Date.now();
  // Limpa entradas antigas destes telefones antes de reescrever.
  for (const key of keys) {
    for (const k of Array.from(entries.keys())) {
      if (k.startsWith(`${key}|`)) entries.delete(k);
    }
    resolvedAt.set(key, now);
  }
  for (const row of (data || []) as { phone_key: string; instance_key: string | null; finished_at: string }[]) {
    if (!row.phone_key || !row.finished_at) continue;
    entries.set(`${row.phone_key}|${instanceKeyOf(row.instance_key)}`, row.finished_at);
  }
}

/**
 * Resolve o status de finalização apenas dos telefones informados.
 * Consulta somente o que não estiver em cache fresco.
 */
export async function resolveFinishedConversations(
  phoneList: (string | null | undefined)[],
  force = false,
): Promise<Map<string, string>> {
  const keys = Array.from(new Set(phoneList.map(finishedPhoneKey).filter(Boolean)));
  if (keys.length === 0) return peekFinishedMap();

  const missing: string[] = [];
  const waits: Promise<void>[] = [];

  for (const key of keys) {
    if (!force && isFresh(resolvedAt.get(key))) continue;
    const pending = inflight.get(key);
    if (pending) { waits.push(pending); continue; }
    missing.push(key);
  }

  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const promise = fetchChunk(chunk).finally(() => {
      for (const k of chunk) inflight.delete(k);
    });
    for (const k of chunk) inflight.set(k, promise);
    waits.push(promise);
  }

  if (waits.length > 0) {
    await Promise.all(waits);
    notify();
  }
  return peekFinishedMap();
}
