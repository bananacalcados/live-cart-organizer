import { describe, it, expect, vi, beforeEach } from "vitest";
const insert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert: (r: any) => { insert(r); return { select: () => ({ single: async () => insert.mock.results.at(-1)?.value ?? { data: { id: "r1", ...r }, error: null } }) }; } }) } }));
import { buildEditBody, createDebouncedRunner, DEFAULT_EDIT, editWarnings, fixEdit, loadEditSettings, outputSize, resultLine, saveEditedPhoto } from "@/lib/productPhotoEdit";

const full = { x: 0, y: 0, w: 1, h: 1 };
const svc = (n: string) => `https://fotos.servidorbanana.com/${n}`;
const OK = { id: "b".repeat(32), thumb: svc("t.webp"), medium: svc("m.webp"), full: svc("g.png"), width: 1080, height: 1080, format: "png", bytes: 1, kb: 1, fits: true, upscaled: false, low_quality: false };

describe("editor de foto: montagem do pedido", () => {
  it("padrão: 1080x1080, WebP, cortar, até 100 KB, sem recorte quando é a foto inteira", () => {
    const b = buildEditBody("m", "preto", "p", DEFAULT_EDIT, full, 1, true);
    expect(b).toEqual({ master: "m", color: "preto", source_photo_id: "p", preview: true, options: { width: 1080, height: 1080, fit: "cover", format: "webp", max_kb: 100 } });
  });
  it("encaixar inteira manda a cor do fundo; cortar não manda", () => {
    expect(buildEditBody("m", "c", "p", { ...DEFAULT_EDIT, fit: "contain" }, full, 1, true).options.background).toBe("#ffffff");
    expect(buildEditBody("m", "c", "p", DEFAULT_EDIT, full, 1, true).options).not.toHaveProperty("background");
  });
  it.each(["webp", "jpeg", "png"] as const)("formato %s vai no pedido", (f) => expect(buildEditBody("m", "c", "p", { ...DEFAULT_EDIT, format: f }, full, 1, true).options.format).toBe(f));
  it("recorte vai em frações 0..1", () => {
    expect(buildEditBody("m", "c", "p", DEFAULT_EDIT, { x: 0.12345, y: 0.2, w: 0.5, h: 0.95 }, 1, true).options.crop).toEqual({ x: 0.1235, y: 0.2, w: 0.5, h: 0.8 });
  });
  it("transparente bloqueia JPG (vira PNG)", () => {
    expect(fixEdit({ ...DEFAULT_EDIT, fit: "contain", background: "transparent", format: "jpeg" }).format).toBe("png");
    expect(fixEdit({ ...DEFAULT_EDIT, background: "transparent", format: "webp" }).format).toBe("webp");
  });
  it("peso vazio = sem limite; 4:5 em 1080 = 864x1080", () => {
    expect(buildEditBody("m", "c", "p", { ...DEFAULT_EDIT, maxKb: null }, full, 1, true).options).not.toHaveProperty("max_kb");
    expect(outputSize({ ...DEFAULT_EDIT, ratio: "4:5" }, 1)).toEqual({ width: 864, height: 1080 });
  });
  it("configuração salva abre no padrão do Matthews", () => {
    expect(loadEditSettings({ getItem: () => JSON.stringify({ format: "png", maxKb: 200 }) })).toMatchObject({ format: "png", maxKb: 200, ratio: "1:1" });
    expect(loadEditSettings({ getItem: () => null })).toEqual(DEFAULT_EDIT);
  });
});

describe("prévia com espera", () => {
  it("só chama 400 ms depois da última mudança e cancela a anterior", async () => {
    vi.useFakeTimers();
    const r = createDebouncedRunner(400); const calls: AbortSignal[] = [];
    const fn = async (s: AbortSignal) => { calls.push(s); };
    r.run(fn); vi.advanceTimersByTime(300); r.run(fn); vi.advanceTimersByTime(399);
    expect(calls.length).toBe(0);
    vi.advanceTimersByTime(1); expect(calls.length).toBe(1);
    r.run(fn); expect(calls[0].aborted).toBe(true);
    vi.useRealTimers();
  });
});

describe("avisos", () => {
  const base = { width: 1080, height: 1080, format: "webp", bytes: 1, kb: 31.2, fits: true, upscaled: false, low_quality: false };
  it("linha do resultado", () => expect(resultLine(base)).toBe("1080 x 1080 · WebP · 31 KB"));
  it("não coube", () => expect(editWarnings({ ...base, fits: false, kb: 140 }, 100)).toEqual(["Não coube em 100 KB (ficou com 140 KB). Tente WebP, um tamanho menor ou um limite maior."]));
  it("compressão forte e ampliada", () => expect(editWarnings({ ...base, low_quality: true, upscaled: true }, 100)).toEqual(["Coube, mas a compressão ficou forte: confira a imagem.", "A foto original é menor que o tamanho pedido e foi ampliada."]));
});

describe("salvar como nova foto", () => {
  beforeEach(() => { insert.mockReset(); });
  it("grava com source 'edit' no fim do bloco, com a extensão real", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(OK), { status: 200 }));
    const body = buildEditBody("m", "preto", "p", DEFAULT_EDIT, full, 1, true);
    await saveEditedPhoto("tk", body, "Preto", 7);
    expect(JSON.parse((f.mock.calls[0][1] as any).body).preview).toBe(false);
    expect(insert.mock.calls[0][0]).toMatchObject({ source: "edit", position: 7, color_key: "preto", url_full: svc("g.png") });
    f.mockRestore();
  });
  it("se o link não salvar, apaga a foto no serviço", async () => {
    insert.mockReturnValue({ data: null, error: { message: "x" } });
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(OK), { status: 200 }));
    await expect(saveEditedPhoto("tk", buildEditBody("m", "c", "p", DEFAULT_EDIT, full, 1, true), "C", 0)).rejects.toThrow();
    expect(String(f.mock.calls[1][0])).toContain("/api/delete?id=" + "b".repeat(32));
    f.mockRestore();
  });
});
