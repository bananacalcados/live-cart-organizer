import { supabase } from "@/integrations/supabase/client";

export interface ItemPhoto { thumb: string; medium: string; full: string }
type Fetcher = (keys: string[]) => Promise<Record<string, ItemPhoto>>;

const MAX_BATCH = 200;

/** Session cache + 150 ms batching: one RPC per burst of new keys, never per row. Failures are silent. */
export function createItemPhotoCache(fetcher: Fetcher, delayMs = 150) {
  const cache = new Map<string, ItemPhoto | null>();
  const pending = new Set<string>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    timer = null;
    const keys = [...pending].slice(0, MAX_BATCH);
    keys.forEach((k) => pending.delete(k));
    if (pending.size) timer = setTimeout(flush, delayMs);
    let res: Record<string, ItemPhoto> = {};
    try { res = await fetcher(keys); } catch { res = {}; }
    keys.forEach((k) => cache.set(k, res[k] ?? null));
    listeners.forEach((l) => l());
  };

  return {
    request(keys: string[]) {
      for (const raw of keys) {
        const k = (raw || "").trim();
        if (k && !cache.has(k) && !pending.has(k)) pending.add(k);
      }
      if (pending.size && !timer) timer = setTimeout(flush, delayMs);
    },
    get: (k?: string | null) => (k ? cache.get(k.trim()) ?? null : null),
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

export const itemPhotoCache = createItemPhotoCache(async (keys) => {
  const { data, error } = await supabase.rpc("pos_item_photos" as any, { p_keys: keys });
  if (error || !Array.isArray(data)) return {};
  const out: Record<string, ItemPhoto> = {};
  for (const r of data as any[]) out[r.key] = { thumb: r.thumb, medium: r.medium, full: r.full_url };
  return out;
});

/** Barcode first, SKU as fallback. */
export const itemPhotoKey = (it: { barcode?: string | null; sku?: string | null }) =>
  (it.barcode || "").trim() || (it.sku || "").trim() || "";
