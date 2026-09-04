import { supabase } from "@/integrations/supabase/client";

/**
 * Cache compartilhado de conversas finalizadas (chat_finished_conversations).
 *
 * Antes, cada tela de chat (Chat, POSWhatsApp, DashboardChatPanel,
 * GlobalWhatsAppChat) baixava a tabela INTEIRA paginando de 1.000 em 1.000 a
 * cada montagem — 20k+ consultas e minutos de CPU do banco.
 *
 * Agora resolvemos SOMENTE os telefones visíveis, em lotes, via a RPC
 * `resolve_finished_conversations` (usa o índice de sufixo DDD+8), com cache em
 * memória por telefone (TTL), de-dupe de chamadas simultâneas e notificação
 * para os assinantes.
 */

const TTL_MS = 5 * 60 * 1000;
const CHUNK = 300;

export function finishedPhoneKey(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  return digits ? digits.slice(-8) : "";
}

/** key8 -> { finishedAt (null = não finalizada), at } */
const entries = new Map<string, { finishedAt: string | null; at: number }>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function isFresh(at: number) {
  return Date.now() - at < TTL_MS;
}

// Notificação COALESCIDA: várias escritas seguidas (finalização em massa,
// rajada de eventos realtime) viram UM único re-render dos assinantes em vez
// de um por telefone — cada re-render remonta a lista inteira de conversas.
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

/** Snapshot síncrono do que já foi resolvido (sem disparar requisição). */
export function peekFinishedMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, entry] of entries) {
    if (entry.finishedAt) map.set(key, entry.finishedAt);
  }
  return map;
}

/** Grava/atualiza uma entrada localmente (escrita otimista e realtime). */
export function setFinishedLocal(phone: string, finishedAt: string | null) {
  const key = finishedPhoneKey(phone);
  if (!key) return;
  entries.set(key, { finishedAt, at: Date.now() });
  notify();
}

/** Versão em lote de setFinishedLocal (uma única notificação). */
export function setFinishedLocalMany(phones: string[], finishedAt: string | null) {
  const now = Date.now();
  for (const phone of phones) {
    const key = finishedPhoneKey(phone);
    if (key) entries.set(key, { finishedAt, at: now });
  }
  notify();
}

export function invalidateFinishedCache(phone?: string) {
  if (phone) entries.delete(finishedPhoneKey(phone));
  else entries.clear();
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
  const found = new Set<string>();
  for (const row of (data || []) as { phone_key: string; finished_at: string }[]) {
    if (!row.phone_key) continue;
    found.add(row.phone_key);
    entries.set(row.phone_key, { finishedAt: row.finished_at, at: Date.now() });
  }
  for (const key of keys) {
    if (!found.has(key)) entries.set(key, { finishedAt: null, at: Date.now() });
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
    const entry = entries.get(key);
    if (!force && entry && isFresh(entry.at)) continue;
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
