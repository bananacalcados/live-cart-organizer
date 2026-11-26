import { supabase } from "@/integrations/supabase/client";
import { deletePhoto, parseUploadResponse, PHOTO_SERVICE_BASE } from "@/lib/productPhotos";

/** Photo editor on the owner's service (/api/edit); the original photo is never changed. */
export type EditFit = "cover" | "contain";
export type EditFormat = "webp" | "jpeg" | "png";
export type EditRatio = "1:1" | "4:5" | "3:4" | "9:16" | "16:9" | "livre";
export interface Crop { x: number; y: number; w: number; h: number }
export interface EditSettings {
  ratio: EditRatio; size: number | "custom"; width: number; height: number;
  fit: EditFit; background: string; format: EditFormat; maxKb: number | null;
}
export const RATIOS: { v: EditRatio; l: string }[] = [
  { v: "1:1", l: "Quadrado 1:1" }, { v: "4:5", l: "4:5" }, { v: "3:4", l: "3:4" }, { v: "9:16", l: "9:16" }, { v: "16:9", l: "16:9" }, { v: "livre", l: "Livre" },
];
export const SIZES = [1080, 1600, 2048];
export const DEFAULT_EDIT: EditSettings = { ratio: "1:1", size: 1080, width: 1080, height: 1080, fit: "cover", background: "#ffffff", format: "webp", maxKb: 100 };
export const EDIT_STORE_KEY = "photo_edit_last_settings";

export function ratioValue(r: EditRatio): number | null {
  if (r === "livre") return null;
  const [a, b] = r.split(":").map(Number); return a / b;
}

/** Final pixel size: preset = longer side, ratio from the chosen proportion (or the crop for "Livre"). */
export function outputSize(s: EditSettings, cropAspectPx: number): { width: number; height: number } {
  const clamp = (n: number) => Math.max(100, Math.min(4096, Math.round(n)));
  if (s.size === "custom") return { width: clamp(s.width), height: clamp(s.height) };
  const r = ratioValue(s.ratio) ?? cropAspectPx;
  return r >= 1 ? { width: clamp(s.size), height: clamp(s.size / r) } : { width: clamp(s.size * r), height: clamp(s.size) };
}

/** Transparent only in contain and never with JPG: switches JPG to PNG. */
export function fixEdit(s: EditSettings): EditSettings {
  if (s.background === "transparent" && s.format === "jpeg") return { ...s, format: "png" };
  return s;
}

const round4 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
export function normalizeCrop(c: Crop): Crop | undefined {
  const x = round4(c.x), y = round4(c.y);
  const w = round4(Math.min(c.w, 1 - x)), h = round4(Math.min(c.h, 1 - y));
  if (x === 0 && y === 0 && w >= 0.9999 && h >= 0.9999) return undefined;
  return { x, y, w, h };
}

export function buildEditBody(master: string, color: string, sourcePhotoId: string, s0: EditSettings, crop: Crop, cropAspectPx: number, preview: boolean) {
  const s = fixEdit(s0);
  const { width, height } = outputSize(s, cropAspectPx);
  const options: Record<string, unknown> = { width, height, fit: s.fit, format: s.format };
  if (s.fit === "contain") options.background = s.background;
  const c = normalizeCrop(crop); if (c) options.crop = c;
  if (s.maxKb != null && s.maxKb > 0) options.max_kb = Math.max(10, Math.min(10000, Math.round(s.maxKb)));
  return { master, color, source_photo_id: sourcePhotoId, preview, options };
}

export interface EditResult { width: number; height: number; format: string; bytes: number; kb: number; quality?: number; fits: boolean; upscaled: boolean; low_quality: boolean; data_url?: string }
export const FORMAT_LABEL: Record<string, string> = { webp: "WebP", jpeg: "JPG", jpg: "JPG", png: "PNG" };
export const resultLine = (r: EditResult) => `${r.width} x ${r.height} · ${FORMAT_LABEL[r.format] || r.format} · ${Math.round(r.kb)} KB`;

export function editWarnings(r: EditResult, maxKb: number | null): string[] {
  const w: string[] = [];
  if (r.fits === false) w.push(`Não coube em ${maxKb ?? "?"} KB (ficou com ${Math.round(r.kb)} KB). Tente WebP, um tamanho menor ou um limite maior.`);
  else if (r.low_quality) w.push("Coube, mas a compressão ficou forte: confira a imagem.");
  if (r.upscaled) w.push("A foto original é menor que o tamanho pedido e foi ampliada.");
  return w;
}

export function editErrorMessage(status: number, j: any): string {
  if (status === 400) return `Opção inválida${j?.campo ? ` (${j.campo})` : ""}.`;
  if (status === 401) return "Sessão expirada ou sem permissão. Entre de novo.";
  if (status === 404) return "Foto de origem não encontrada no serviço.";
  if (status === 422) return "Não foi possível editar esta foto.";
  if (status === 429) return "Muitas edições seguidas. Espere um pouco.";
  return "Serviço de fotos indisponível.";
}

export async function callEdit(token: string, body: ReturnType<typeof buildEditBody>, signal?: AbortSignal): Promise<any> {
  const r = await fetch(`${PHOTO_SERVICE_BASE}/api/edit`, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(editErrorMessage(r.status, j));
  return j;
}

/** Saves the edited photo as a NEW row (source='edit') at the end of the block; removes the service file if the insert fails. */
export async function saveEditedPhoto(token: string, body: ReturnType<typeof buildEditBody>, label: string, position: number) {
  const j = await callEdit(token, { ...body, preview: false });
  const up = parseUploadResponse(j);
  if (!up) throw new Error("Resposta inesperada do serviço de fotos.");
  const { data: row, error } = await supabase.from("product_color_photos").insert({
    master_id: body.master, color_key: body.color, color: label, photo_id: up.id,
    url_thumb: up.thumb, url_medium: up.medium, url_full: up.full,
    width: up.width ?? null, height: up.height ?? null, position, source: "edit",
  } as any).select("id,color_key,photo_id,url_thumb,url_medium,url_full,position,source").single();
  if (error) { await deletePhoto(up.id, token).catch(() => {}); throw new Error("Não consegui salvar o link da foto editada."); }
  return { row, result: j as EditResult };
}

/** Debounced runner: waits `ms` after the last call and aborts the previous request. */
export function createDebouncedRunner(ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ctrl: AbortController | null = null;
  return {
    run(fn: (signal: AbortSignal) => Promise<void>) {
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      timer = setTimeout(() => { ctrl = new AbortController(); fn(ctrl.signal).catch(() => {}); }, ms);
    },
    cancel() { if (timer) clearTimeout(timer); ctrl?.abort(); },
  };
}

export function loadEditSettings(store: Pick<Storage, "getItem"> | null = safeStore()): EditSettings {
  try { const v = JSON.parse(store?.getItem(EDIT_STORE_KEY) || "null"); return v ? fixEdit({ ...DEFAULT_EDIT, ...v }) : DEFAULT_EDIT; } catch { return DEFAULT_EDIT; }
}
export function saveEditSettings(s: EditSettings, store: Pick<Storage, "setItem"> | null = safeStore()) { try { store?.setItem(EDIT_STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
function safeStore() { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }

/** Crop box locked to ratio (in source pixels aspect), centered and as large as possible. */
export function fitCrop(ratio: number | null, imgAspect: number): Crop {
  if (!ratio) return { x: 0, y: 0, w: 1, h: 1 };
  const rel = ratio / imgAspect; // w/h in fractions
  return rel >= 1 ? { x: 0, w: 1, h: 1 / rel, y: (1 - 1 / rel) / 2 } : { y: 0, h: 1, w: rel, x: (1 - rel) / 2 };
}
