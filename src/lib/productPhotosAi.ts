import { PHOTO_SERVICE_BASE } from "@/lib/productPhotos";

/** AI photo generation goes only through the owner's photo service; the ERP never holds the AI key. */
export interface LibItem { id: string; name: string; scope?: string; image?: string; gender?: string; age_range?: string; distances?: string[]; kind?: string }
export interface AiLibrary {
  styles: LibItem[]; models: LibItem[]; poses: LibItem[]; backgrounds: LibItem[];
  credits: number; daily_limit: number; daily_used: number;
  ratios: string[]; framing: string[]; shadow: string[]; camera_distance: string[];
}
export type ModelChoice = { type: "none" } | { type: "automatic" } | { type: "selected"; id: string };
export type BgChoice = { type: "automatic" } | { type: "transparent" } | { type: "color"; color: string } | { type: "background"; id: string };
export interface AiOptions {
  mode: "single_shots" | "photoshoot";
  image_count: number;
  aspect_ratio: string;
  resolution: "1k" | "2k" | "4k";
  model: ModelChoice;
  pose_id?: string;
  framing?: string; shadow?: string; camera_distance?: string;
  background: BgChoice;
  style_id?: string;
  directions?: string;
  output_format?: OutputFormat;
}
export type OutputFormat = "jpeg" | "png" | "webp";
/** JPG cannot hold transparency: a transparent background forces PNG. */
export function fixFormat(o: AiOptions): AiOptions {
  const f: OutputFormat = o.output_format === "png" || o.output_format === "webp" ? o.output_format : "jpeg";
  return { ...o, output_format: o.background?.type === "transparent" && f === "jpeg" ? "png" : f };
}
export interface AiPhoto { id: string; thumb: string; medium: string; full: string; width?: number; height?: number }
export interface AiJob { id: string; status: "fila" | "enviando" | "gerando" | "concluido" | "falhou"; photos: AiPhoto[]; failed: number; error?: string | null; cost?: number; credits?: number }

export const FEATURED_RATIOS = ["1:1", "4:5", "3:4", "9:16", "16:9"];

export const DEFAULT_OPTIONS: AiOptions = {
  mode: "single_shots", image_count: 1, aspect_ratio: "1:1", resolution: "2k",
  model: { type: "none" }, background: { type: "automatic" }, output_format: "jpeg",
};

const LABELS: Record<string, string> = {
  close: "Perto", medium: "Média", far: "Longe", close_up: "Close", closeup: "Close",
  none: "Nenhuma", soft: "Suave", hard: "Forte", natural: "Natural", drop: "Projetada", contact: "De contato",
  full_body: "Corpo inteiro", half_body: "Meio corpo", upper_body: "Da cintura para cima", lower_body: "Da cintura para baixo",
  product: "Só o produto", centered: "Centralizado", auto: "Automático", automatic: "Automático",
};
export const ptLabel = (v: string) => LABELS[v] || v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const FIELD_LABELS: Record<string, string> = {
  master: "produto", color: "cor", source_photo_id: "foto de origem", mode: "modo", image_count: "quantidade",
  aspect_ratio: "proporção", resolution: "resolução", model: "modelo", pose_id: "pose", framing: "enquadramento",
  shadow: "sombra", camera_distance: "distância da câmera", background: "fundo", style_id: "estilo", directions: "orientações", output_format: "tipo de arquivo",
};

/** Cleans options so only fields the contract allows for the mode are sent. */
export function normalizeOptions(o: AiOptions): AiOptions {
  const shoot = o.mode === "photoshoot";
  const out: AiOptions = {
    mode: o.mode,
    image_count: shoot ? 4 : Math.min(4, Math.max(1, Math.round(o.image_count || 1))),
    aspect_ratio: o.aspect_ratio,
    resolution: shoot && o.resolution === "4k" ? "2k" : o.resolution,
    model: o.model, background: o.background,
    output_format: fixFormat(o).output_format,
  };
  if (!shoot && o.model.type !== "none" && o.pose_id) out.pose_id = o.pose_id;
  if (!shoot && o.framing) out.framing = o.framing;
  if (!shoot && o.shadow) out.shadow = o.shadow;
  if (!shoot && o.camera_distance) out.camera_distance = o.camera_distance;
  if (o.style_id) out.style_id = o.style_id;
  const d = (o.directions || "").trim().slice(0, 2000);
  if (d) out.directions = d;
  return out;
}

export function buildGenerateBody(master: string, color: string, sourcePhotoId: string, o: AiOptions) {
  const n = normalizeOptions(o);
  const { image_count, ...rest } = n;
  return { master, color, source_photo_id: sourcePhotoId, options: n.mode === "photoshoot" ? rest : n };
}

export function estimateCost(o: AiOptions): number {
  const n = normalizeOptions(o);
  if (n.mode === "photoshoot") return 2;
  return n.image_count * (n.resolution === "4k" ? 2 : 1);
}

export function remainingToday(lib: Pick<AiLibrary, "daily_limit" | "daily_used">) {
  return Math.max(0, (lib.daily_limit || 0) - (lib.daily_used || 0));
}

/** Drops ids that no longer exist in the library; returns the names of dropped fields. */
export function applyPreset(raw: any, lib: AiLibrary): { options: AiOptions; dropped: string[] } {
  const dropped: string[] = [];
  const has = (list: LibItem[], id?: string) => !!id && list.some((x) => x.id === id);
  const o: AiOptions = { ...DEFAULT_OPTIONS, ...(raw || {}) };
  if (o.model?.type === "selected" && !has(lib.models, (o.model as any).id)) { o.model = { type: "automatic" }; dropped.push("modelo"); }
  if (o.pose_id && !has(lib.poses, o.pose_id)) { delete o.pose_id; dropped.push("pose"); }
  if (o.style_id && !has(lib.styles, o.style_id)) { delete o.style_id; dropped.push("estilo"); }
  if (o.background?.type === "background" && !has(lib.backgrounds, (o.background as any).id)) { o.background = { type: "automatic" }; dropped.push("fundo"); }
  if (lib.ratios?.length && !lib.ratios.includes(o.aspect_ratio)) { o.aspect_ratio = "1:1"; dropped.push("proporção"); }
  return { options: normalizeOptions(o), dropped };
}

const okUrl = (u: unknown) => typeof u === "string" && u.startsWith(PHOTO_SERVICE_BASE + "/");
export function parseJob(j: any): AiJob | null {
  if (!j || typeof j.id !== "string" || typeof j.status !== "string") return null;
  const photos = Array.isArray(j.photos) ? j.photos.filter((p: any) => p && typeof p.id === "string" && /^[0-9a-f]{32}$/.test(p.id) && okUrl(p.thumb) && okUrl(p.medium) && okUrl(p.full)) : [];
  return { id: j.id, status: j.status, photos, failed: Number(j.failed) || 0, error: j.error ?? null, cost: j.cost, credits: j.credits };
}

export class AiError extends Error { constructor(msg: string, public status: number, public code?: string, public field?: string) { super(msg); } }

export function aiErrorMessage(status: number, j: any): AiError {
  const code = j?.error as string | undefined;
  const field = j?.campo as string | undefined;
  if (status === 400) return new AiError(`Opção inválida${field ? `: ${FIELD_LABELS[field] || field}` : ""}.`, status, code, field);
  if (status === 401) return new AiError("Sessão expirada, entre de novo.", status, code);
  if (status === 404) return new AiError("A foto de origem não existe mais no serviço.", status, code);
  if (status === 429 && code === "limite_diario_de_creditos") return new AiError("Limite diário de créditos atingido. Volta amanhã.", status, code);
  if (status === 429) return new AiError("Já tem geração rodando, espere terminar.", status, code);
  if (status === 503) return new AiError("IA não configurada no serviço de fotos.", status, code);
  return new AiError(code ? `Erro no serviço de fotos: ${code}` : "Serviço de fotos indisponível.", status, code);
}

async function call(path: string, token: string, init?: RequestInit) {
  const r = await fetch(`${PHOTO_SERVICE_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw aiErrorMessage(r.status, j);
  return j;
}

export const fetchLibrary = (token: string) => call("/api/ia/library", token) as Promise<AiLibrary>;
export async function startGeneration(token: string, body: ReturnType<typeof buildGenerateBody>) {
  const j = await call("/api/ia/generate", token, { method: "POST", body: JSON.stringify(body) });
  if (typeof j?.job_id !== "string") throw new AiError("Resposta inesperada do serviço de fotos.", 500);
  return { job_id: j.job_id as string, custo_estimado: Number(j.custo_estimado) || 0 };
}
export async function fetchJob(token: string, id: string) {
  const j = parseJob(await call(`/api/ia/job?id=${encodeURIComponent(id)}`, token));
  if (!j) throw new AiError("Resposta inesperada do serviço de fotos.", 500);
  return j;
}
