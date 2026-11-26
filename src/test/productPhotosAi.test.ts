import { describe, it, expect, vi } from "vitest";
import { buildGenerateBody, estimateCost, normalizeOptions, applyPreset, parseJob, aiErrorMessage, DEFAULT_OPTIONS, remainingToday, type AiLibrary } from "@/lib/productPhotosAi";
import { saveJobPhotos } from "@/hooks/useAiPhotoJobs";
import { addPending, readPending, removePending } from "@/lib/productPhotosAiPending";

const B = "https://fotos.servidorbanana.com/";
const id32 = (c: string) => c.repeat(32);
const lib: AiLibrary = { styles: [{ id: "s1", name: "S" }], models: [{ id: "m1", name: "M" }], poses: [{ id: "p1", name: "P" }], backgrounds: [{ id: "b1", name: "B" }],
  credits: 100, daily_limit: 40, daily_used: 38, ratios: ["1:1", "4:5"], framing: [], shadow: [], camera_distance: [] };

describe("opções da IA", () => {
  it("ensaio remove pose/enquadramento/distância/quantidade e rebaixa 4K", () => {
    const b = buildGenerateBody("m", "preto", "x", { ...DEFAULT_OPTIONS, mode: "photoshoot", resolution: "4k", image_count: 2,
      model: { type: "selected", id: "m1" }, pose_id: "p1", framing: "f", camera_distance: "close", shadow: "soft" });
    expect(b.options).toEqual({ mode: "photoshoot", aspect_ratio: "1:1", resolution: "2k", model: { type: "selected", id: "m1" }, background: { type: "automatic" } });
  });
  it("sem modelo não manda pose; avulsas mantém quantidade 1..4", () => {
    const n = normalizeOptions({ ...DEFAULT_OPTIONS, pose_id: "p1", image_count: 9 });
    expect(n.pose_id).toBeUndefined();
    expect(n.image_count).toBe(4);
  });
  it("orientações cortadas em 2000 e vazias omitidas", () => {
    expect(normalizeOptions({ ...DEFAULT_OPTIONS, directions: "  " }).directions).toBeUndefined();
    expect(normalizeOptions({ ...DEFAULT_OPTIONS, directions: "a".repeat(2500) }).directions!.length).toBe(2000);
  });
  it("custo: 1 por foto 1K/2K, 2 em 4K, ensaio = 2", () => {
    expect(estimateCost({ ...DEFAULT_OPTIONS, image_count: 3, resolution: "2k" })).toBe(3);
    expect(estimateCost({ ...DEFAULT_OPTIONS, image_count: 3, resolution: "4k" })).toBe(6);
    expect(estimateCost({ ...DEFAULT_OPTIONS, mode: "photoshoot", resolution: "4k" })).toBe(2);
    expect(remainingToday(lib)).toBe(2);
  });
  it("kit com ids sumidos volta ao padrão e avisa", () => {
    const r = applyPreset({ ...DEFAULT_OPTIONS, model: { type: "selected", id: "x" }, style_id: "gone", background: { type: "background", id: "b1" } }, lib);
    expect(r.options.model).toEqual({ type: "automatic" });
    expect(r.options.style_id).toBeUndefined();
    expect(r.options.background).toEqual({ type: "background", id: "b1" });
    expect(r.dropped).toEqual(["modelo", "estilo"]);
  });
});

describe("respostas do serviço", () => {
  it("só aceita fotos com links do serviço", () => {
    const j = parseJob({ id: "j", status: "concluido", failed: 1, photos: [
      { id: id32("a"), thumb: B + "t", medium: B + "m", full: B + "f" }, { id: id32("b"), thumb: "https://evil/x", medium: B, full: B }] });
    expect(j!.photos.map((p) => p.id)).toEqual([id32("a")]);
    expect(j!.failed).toBe(1);
  });
  it("traduz os erros", () => {
    expect(aiErrorMessage(400, { error: "opcao_invalida", campo: "pose_id" }).message).toBe("Opção inválida: pose.");
    expect(aiErrorMessage(429, { error: "limite_diario_de_creditos" }).message).toMatch(/Limite diário/);
    expect(aiErrorMessage(429, { error: "muitas_geracoes_ao_mesmo_tempo" }).message).toMatch(/espere terminar/);
    expect(aiErrorMessage(503, {}).message).toMatch(/não configurada/);
    expect(aiErrorMessage(404, {}).message).toMatch(/origem/);
  });
});

describe("salvar fotos prontas", () => {
  const ph = (c: string) => ({ id: id32(c), thumb: B, medium: B, full: B });
  it("salva no fim do bloco, apaga só quando o salvamento falha e nunca apaga repetida", async () => {
    const remove = vi.fn(async () => {});
    const positions: number[] = [];
    const rows = await saveJobPhotos([ph("a"), ph("b"), ph("c"), ph("d")], 5, async (p, pos) => {
      positions.push(pos);
      if (p.id === id32("b")) return { row: null, duplicate: true, error: false };
      if (p.id === id32("c")) return { row: null, duplicate: false, error: true };
      return { row: { id: p.id }, duplicate: false, error: false };
    }, remove);
    expect(rows.map((r) => r.id)).toEqual([id32("a"), id32("d")]);
    expect(positions).toEqual([5, 6, 6, 6]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(id32("c"));
  });
});

describe("gerações pendentes", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it("guarda por usuária, remove e descarta após 24h", () => {
    const st = mem();
    addPending("u1", { job_id: "j1", master: "m", color: "preto", label: "Preto", started_at: Date.now() }, st);
    addPending("u1", { job_id: "j1", master: "m", color: "preto", label: "Preto", started_at: Date.now() }, st);
    expect(readPending("u1", Date.now(), st)).toHaveLength(1);
    expect(readPending("u2", Date.now(), st)).toHaveLength(0);
    expect(readPending("u1", Date.now() + 25 * 3600_000, st)).toHaveLength(0);
    addPending("u1", { job_id: "j2", master: "m", color: "preto", label: "Preto", started_at: Date.now() }, st);
    removePending("u1", "j2", st);
    expect(readPending("u1", Date.now(), st)).toHaveLength(0);
  });
});
