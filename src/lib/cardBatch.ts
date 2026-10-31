/**
 * Junta pedidos individuais dos cartões do quadro em UMA consulta em lote.
 * Cada cartão chama `load(id)`; ids pedidos no mesmo instante (janela curta)
 * viram uma única busca `.in(...)`. Resultado fica em cache por `ttlMs`, então
 * remontar o quadro não refaz as consultas.
 */
export function createBatcher<T>(
  fetchMany: (ids: string[]) => Promise<Map<string, T>>,
  opts: { ttlMs?: number; windowMs?: number; chunk?: number } = {},
) {
  const ttl = opts.ttlMs ?? 60_000;
  const windowMs = opts.windowMs ?? 30;
  const chunk = opts.chunk ?? 100;
  const cache = new Map<string, { at: number; value: T | null }>();
  let queue = new Map<string, Array<(v: T | null) => void>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    timer = null;
    const current = queue;
    queue = new Map();
    const ids = Array.from(current.keys());
    for (let i = 0; i < ids.length; i += chunk) {
      const part = ids.slice(i, i + chunk);
      let res = new Map<string, T>();
      try { res = await fetchMany(part); } catch { /* resolve null */ }
      const now = Date.now();
      for (const id of part) {
        const v = res.has(id) ? (res.get(id) as T) : null;
        cache.set(id, { at: now, value: v });
        for (const cb of current.get(id) || []) cb(v);
      }
    }
  };

  return {
    load(id: string, force = false): Promise<T | null> {
      const hit = cache.get(id);
      if (!force && hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
      return new Promise((resolve) => {
        const list = queue.get(id) || [];
        list.push(resolve);
        queue.set(id, list);
        if (!timer) timer = setTimeout(flush, windowMs);
      });
    },
    invalidate(id?: string) { if (id) cache.delete(id); else cache.clear(); },
  };
}

/** Cache simples (com deduplicação de chamadas em andamento) por chave. */
export function createKeyedCache<T>(fetchOne: (key: string) => Promise<T>, ttlMs = 60_000) {
  const cache = new Map<string, { at: number; p: Promise<T> }>();
  return {
    load(key: string, force = false): Promise<T> {
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < ttlMs) return hit.p;
      const p = fetchOne(key).catch((e) => { cache.delete(key); throw e; });
      cache.set(key, { at: Date.now(), p });
      return p;
    },
    invalidate(key?: string) { if (key) cache.delete(key); else cache.clear(); },
  };
}
