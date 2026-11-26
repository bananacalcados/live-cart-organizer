/** Pending AI jobs kept per user in this browser so a paid generation is reconciled when the product reopens. */
export interface PendingJob { job_id: string; master: string; color: string; label: string; started_at: number }
const TTL = 24 * 60 * 60 * 1000;
const keyOf = (userId: string) => `ai_photo_jobs:${userId}`;

type Store = Pick<Storage, "getItem" | "setItem">;
const safe = (): Store | null => { try { return window.localStorage; } catch { return null; } };

export function readPending(userId: string, now = Date.now(), store: Store | null = safe()): PendingJob[] {
  if (!store) return [];
  let list: PendingJob[] = [];
  try { list = JSON.parse(store.getItem(keyOf(userId)) || "[]"); } catch { list = []; }
  if (!Array.isArray(list)) return [];
  const fresh = list.filter((j) => j && typeof j.job_id === "string" && now - j.started_at < TTL);
  if (fresh.length !== list.length) try { store.setItem(keyOf(userId), JSON.stringify(fresh)); } catch { /* ignore */ }
  return fresh;
}
export function addPending(userId: string, job: PendingJob, store: Store | null = safe()) {
  if (!store) return;
  const list = readPending(userId, Date.now(), store).filter((j) => j.job_id !== job.job_id);
  try { store.setItem(keyOf(userId), JSON.stringify([...list, job])); } catch { /* ignore */ }
}
export function removePending(userId: string, jobId: string, store: Store | null = safe()) {
  if (!store) return;
  const list = readPending(userId, Date.now(), store).filter((j) => j.job_id !== jobId);
  try { store.setItem(keyOf(userId), JSON.stringify(list)); } catch { /* ignore */ }
}
