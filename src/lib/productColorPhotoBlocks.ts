import { supabase } from "@/integrations/supabase/client";
import { colorSlug, deletePhoto, uploadPhoto } from "@/lib/productPhotos";

/** Shared by desktop "Fotos por cor" and the mobile sheet: block rules, upload+save and delete. */
export interface PhotoRow { id: string; color_key: string; photo_id: string; url_thumb: string; url_medium: string; url_full: string; position: number; source?: string | null; }
export interface PhotoBlock { key: string; label: string; }

export function buildPhotoBlocks(variantColors: string[], codes: { color: string | null; color_key: string | null }[]): PhotoBlock[] {
  const m = new Map<string, string>();
  const labels = [...variantColors.filter(Boolean), ...codes.map((c) => c.color || "")].filter(Boolean);
  for (const label of labels) {
    const code = codes.find((c) => (c.color || "").trim().toLowerCase() === label.trim().toLowerCase());
    const key = colorSlug(code?.color_key, label);
    if (key !== "geral" && !m.has(key)) m.set(key, label);
  }
  return [...m.entries()].map(([key, label]) => ({ key, label })).concat({ key: "geral", label: "Geral (sem cor)" });
}

export function photosForColorBlock(photos: PhotoRow[], key: string, blocks: PhotoBlock[]): PhotoRow[] {
  const knownKeys = new Set(blocks.map((block) => block.key));
  return photos.filter((photo) => key === "geral"
    ? photo.color_key === "geral" || !knownKeys.has(photo.color_key)
    : photo.color_key === key
  ).sort((a, b) => a.position - b.position);
}

export async function photoSessionToken() {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("Sessão expirada. Entre de novo.");
  return t;
}

export async function loadColorPhotoData(masterId: string) {
  const [c, p] = await Promise.all([
    supabase.from("product_color_codes").select("color,color_key").eq("master_id", masterId),
    supabase.from("product_color_photos").select("id,color_key,photo_id,url_thumb,url_medium,url_full,position,source").eq("master_id", masterId).order("position"),
  ]);
  return { codes: (c.data || []) as { color: string | null; color_key: string | null }[], photos: (p.data as PhotoRow[]) || [], error: !!p.error };
}

/** Uploads to the photo service then saves the link; removes the service file if the link cannot be saved. */
export async function uploadAndSaveColorPhoto(file: File, masterId: string, key: string, label: string, position: number, token: string): Promise<PhotoRow> {
  const up = await uploadPhoto(file, masterId, key, token);
  const { data: row, error } = await supabase.from("product_color_photos").insert({
    master_id: masterId, color_key: key, color: label, photo_id: up.id,
    url_thumb: up.thumb, url_medium: up.medium, url_full: up.full,
    width: up.width ?? null, height: up.height ?? null, position,
  }).select("id,color_key,photo_id,url_thumb,url_medium,url_full,position").single();
  if (error) { await deletePhoto(up.id, token).catch(() => {}); throw new Error("Não consegui salvar o link da foto."); }
  return row as PhotoRow;
}

export async function deleteColorPhoto(ph: PhotoRow) {
  await deletePhoto(ph.photo_id, await photoSessionToken());
  const { error } = await supabase.from("product_color_photos").delete().eq("id", ph.id);
  if (error) throw new Error("Foto apagada no serviço, mas o link não saiu do ERP.");
}
