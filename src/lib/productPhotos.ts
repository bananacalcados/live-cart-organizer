/** Product color photos live on the owner's external photo service; the ERP stores only links. */
export const PHOTO_SERVICE_BASE = "https://fotos.servidorbanana.com";
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const PHOTO_ACCEPT = ["image/jpeg", "image/png", "image/webp"];
export const COLOR_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;

export type PhotosMode = "off" | "admin" | "on";

export function parsePhotosMode(v: unknown): PhotosMode {
  return v === "off" || v === "on" || v === "admin" ? v : "admin";
}

export function canSeePhotos(mode: PhotosMode, isAdmin: boolean, hasInventory: boolean): boolean {
  if (mode === "off") return false;
  if (mode === "admin") return isAdmin;
  return isAdmin || hasInventory;
}

export function colorSlug(colorKey?: string | null, label?: string | null): string {
  const src = (colorKey && colorKey.trim()) || (label && label.trim()) || "";
  const s = src
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return COLOR_KEY_RE.test(s) ? s : "sem-cor";
}

export function validatePhotoFile(f: { type: string; size: number }): string | null {
  if (!PHOTO_ACCEPT.includes(f.type)) return "Formato não aceito. Use JPG, PNG ou WEBP.";
  if (f.size > PHOTO_MAX_BYTES) return "Foto maior que 15 MB.";
  return null;
}

export function photoErrorMessage(status: number, serverMsg?: string): string {
  switch (status) {
    case 400: return "Envio inválido. Tente de novo.";
    case 401: return "Sessão expirada ou sem permissão. Entre de novo.";
    case 413: return "Foto maior que 15 MB.";
    case 415: return "Formato não aceito. Use JPG, PNG ou WEBP.";
    case 422: return "Foto pequena demais (mínimo 200 px) ou arquivo corrompido.";
    case 429: return "Muitos envios seguidos. Espere um pouco.";
    default: return serverMsg ? `Erro no serviço de fotos: ${serverMsg}` : "Serviço de fotos indisponível.";
  }
}

export interface UploadedPhoto {
  id: string; thumb: string; medium: string; full: string; width?: number; height?: number;
}

export function parseUploadResponse(j: any): UploadedPhoto | null {
  const okUrl = (u: unknown) => typeof u === "string" && u.startsWith(PHOTO_SERVICE_BASE + "/");
  if (!j || typeof j.id !== "string" || !/^[0-9a-f]{32}$/.test(j.id)) return null;
  if (!okUrl(j.thumb) || !okUrl(j.medium) || !okUrl(j.full)) return null;
  return { id: j.id, thumb: j.thumb, medium: j.medium, full: j.full, width: j.width, height: j.height };
}

export async function uploadPhoto(file: File, masterId: string, colorKey: string, token: string): Promise<UploadedPhoto> {
  const url = `${PHOTO_SERVICE_BASE}/api/upload?master=${encodeURIComponent(masterId)}&color=${encodeURIComponent(colorKey)}`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(photoErrorMessage(r.status, j?.error));
  const p = parseUploadResponse(j);
  if (!p) throw new Error("Resposta inesperada do serviço de fotos.");
  return p;
}

export async function deletePhoto(photoId: string, token: string): Promise<void> {
  const r = await fetch(`${PHOTO_SERVICE_BASE}/api/delete?id=${encodeURIComponent(photoId)}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(photoErrorMessage(r.status, j?.error)); }
}

export function reorderPositions<T>(items: T[], from: number, to: number): (T & { position: number })[] {
  const a = [...items];
  const [m] = a.splice(from, 1);
  a.splice(to, 0, m);
  return a.map((x, i) => ({ ...(x as any), position: i }));
}
