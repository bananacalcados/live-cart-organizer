import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { deletePhoto } from "@/lib/productPhotos";
import { fetchJob, type AiJob, type AiPhoto } from "@/lib/productPhotosAi";
import { addPending, readPending, removePending, type PendingJob } from "@/lib/productPhotosAiPending";

export const POLL_MS = 4000;
export const POLL_CAP_MS = 15 * 60 * 1000;

export interface JobView { job_id: string; color: string; label: string; status: AiJob["status"] | "expirado" | "erro"; error?: string | null; failed?: number; saved?: number }

type InsertResult = { row: any | null; duplicate: boolean; error: boolean };
/** Saves finished photos; a duplicate (already saved by another tab) is never deleted from the service. */
export async function saveJobPhotos(
  photos: AiPhoto[], firstPosition: number,
  insert: (p: AiPhoto, position: number) => Promise<InsertResult>,
  remove: (photoId: string) => Promise<void>,
) {
  const rows: any[] = [];
  let pos = firstPosition;
  for (const p of photos) {
    const r = await insert(p, pos);
    if (r.row) { rows.push(r.row); pos++; }
    else if (r.error && !r.duplicate) await remove(p.id).catch(() => {});
  }
  return rows;
}

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

const SELECT = "id,color_key,photo_id,url_thumb,url_medium,url_full,position,source";

export function useAiPhotoJobs(masterId: string, nextPosition: (colorKey: string) => number, onSaved: (rows: any[]) => void) {
  const [jobs, setJobs] = useState<Record<string, JobView>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const pending = useRef<Record<string, PendingJob>>({});
  const busy = useRef(false);
  const posRef = useRef(nextPosition); posRef.current = nextPosition;
  const savedRef = useRef(onSaved); savedRef.current = onSaved;

  useEffect(() => {
    let off = false;
    supabase.auth.getUser().then(({ data }) => {
      if (off || !data.user) return;
      setUserId(data.user.id);
      const mine = readPending(data.user.id).filter((j) => j.master === masterId);
      mine.forEach((j) => (pending.current[j.job_id] = j));
      if (mine.length) setJobs((s) => ({ ...s, ...Object.fromEntries(mine.map((j) => [j.job_id, { job_id: j.job_id, color: j.color, label: j.label, status: "fila" as const }])) }));
    });
    return () => { off = true; };
  }, [masterId]);

  const track = useCallback((job: PendingJob) => {
    pending.current[job.job_id] = job;
    if (userId) addPending(userId, job);
    setJobs((s) => ({ ...s, [job.job_id]: { job_id: job.job_id, color: job.color, label: job.label, status: "fila" } }));
  }, [userId]);

  const dismiss = useCallback((id: string) => setJobs((s) => { const n = { ...s }; delete n[id]; return n; }), []);

  const finish = useCallback(async (p: PendingJob, job: AiJob, t: string) => {
    const rows = await saveJobPhotos(job.photos, posRef.current(p.color), async (ph, position) => {
      const { data, error } = await supabase.from("product_color_photos").upsert({
        master_id: p.master, color_key: p.color, color: p.label, photo_id: ph.id,
        url_thumb: ph.thumb, url_medium: ph.medium, url_full: ph.full,
        width: ph.width ?? null, height: ph.height ?? null, position, source: "ia",
      }, { onConflict: "master_id,color_key,photo_id", ignoreDuplicates: true }).select(SELECT);
      if (error) return { row: null, duplicate: (error as any).code === "23505", error: true };
      return data && data.length ? { row: data[0], duplicate: false, error: false } : { row: null, duplicate: true, error: false };
    }, (id) => deletePhoto(id, t));
    if (rows.length) savedRef.current(rows);
    return rows.length;
  }, []);

  useEffect(() => {
    if (!Object.values(jobs).some((j) => ["fila", "enviando", "gerando"].includes(j.status))) return;
    const timer = setTimeout(async () => {
      if (document.hidden || busy.current) { setJobs((s) => ({ ...s })); return; }
      busy.current = true;
      try {
        const t = await token();
        if (!t) return;
        for (const v of Object.values(jobs)) {
          if (!["fila", "enviando", "gerando"].includes(v.status)) continue;
          const p = pending.current[v.job_id];
          if (!p) continue;
          if (Date.now() - p.started_at > POLL_CAP_MS) { setJobs((s) => ({ ...s, [v.job_id]: { ...v, status: "expirado" } })); continue; }
          let job: AiJob;
          try { job = await fetchJob(t, v.job_id); } catch { continue; }
          if (job.status === "concluido" || job.status === "falhou") {
            const saved = job.photos.length ? await finish(p, job, t) : 0;
            if (userId) removePending(userId, v.job_id);
            delete pending.current[v.job_id];
            setJobs((s) => ({ ...s, [v.job_id]: { ...v, status: job.status, error: job.error, failed: job.failed, saved } }));
          } else if (job.status !== v.status) setJobs((s) => ({ ...s, [v.job_id]: { ...v, status: job.status } }));
        }
      } finally { busy.current = false; }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [jobs, finish, userId]);

  return { jobs: Object.values(jobs), track, dismiss, userReady: !!userId };
}
