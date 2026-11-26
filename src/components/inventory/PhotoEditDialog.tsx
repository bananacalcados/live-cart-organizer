import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  buildEditBody, callEdit, createDebouncedRunner, editWarnings, fitCrop, fixEdit, loadEditSettings, ratioValue, resultLine, RATIOS, saveEditedPhoto, saveEditSettings, SIZES,
  type Crop, type EditResult, type EditSettings,
} from "@/lib/productPhotoEdit";
import type { PhotoRow } from "@/lib/productColorPhotoBlocks";

interface Props { photo: PhotoRow; colorKey: string; masterId: string; label: string; nextPosition: number; getToken: () => Promise<string>; onClose: () => void; onSaved: (row: PhotoRow) => void }

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; l: string; off?: boolean }[]; onChange: (v: T) => void }) {
  return <div className="flex flex-wrap gap-1">{options.map((o) => (
    <Button key={String(o.v)} type="button" size="sm" variant={value === o.v ? "default" : "outline"} disabled={o.off} onClick={() => onChange(o.v)}>{o.l}</Button>
  ))}</div>;
}

export function PhotoEditDialog({ photo, colorKey, masterId, label, nextPosition, getToken, onClose, onSaved }: Props) {
  const [s, setS] = useState<EditSettings>(loadEditSettings);
  const [imgAspect, setImgAspect] = useState(1);
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, w: 1, h: 1 });
  const [res, setRes] = useState<EditResult | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; c: Crop } | null>(null);
  const runner = useMemo(() => createDebouncedRunner(400), []);
  useEffect(() => () => runner.cancel(), [runner]);

  const set = (p: Partial<EditSettings>) => setS((o) => { const n = fixEdit({ ...o, ...p }); saveEditSettings(n); return n; });
  const ratio = ratioValue(s.ratio);
  const cropAspectPx = (crop.w / crop.h) * imgAspect;
  useEffect(() => { setCrop(fitCrop(ratio, imgAspect)); }, [ratio, imgAspect]);

  const body = buildEditBody(masterId, colorKey, photo.photo_id, s, crop, cropAspectPx, true);
  const key = JSON.stringify(body);
  useEffect(() => {
    runner.run(async (signal) => {
      setLoadingPrev(true); setErr(null);
      try { const j = await callEdit(await getToken(), body, signal); if (!signal.aborted) setRes(j); }
      catch (e: any) { if (!signal.aborted) setErr(e.message); }
      finally { if (!signal.aborted) setLoadingPrev(false); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function onDown(e: React.PointerEvent, mode: "move" | "resize") {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, c: crop };
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current; const el = box.current; if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height;
    if (d.mode === "move") {
      setCrop({ ...d.c, x: Math.min(1 - d.c.w, Math.max(0, d.c.x + dx)), y: Math.min(1 - d.c.h, Math.max(0, d.c.y + dy)) });
    } else {
      let w = Math.max(0.05, Math.min(1 - d.c.x, d.c.w + dx));
      let h = Math.max(0.05, Math.min(1 - d.c.y, d.c.h + dy));
      if (ratio) { const rel = ratio / imgAspect; h = w / rel; if (d.c.y + h > 1) { h = 1 - d.c.y; w = h * rel; } }
      setCrop({ ...d.c, w, h });
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const { row } = await saveEditedPhoto(await getToken(), { ...body, preview: false }, label, nextPosition);
      toast.success("Foto editada salva como nova foto");
      onSaved(row as PhotoRow); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  const warnings = res ? editWarnings(res, s.maxKb) : [];
  const transparent = s.background === "transparent";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col p-0">
        <DialogHeader className="border-b p-4"><DialogTitle>Editar foto · {label}</DialogTitle></DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <div className="space-y-2">
            <div ref={box} className="relative w-full select-none touch-none bg-muted" onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
              <img src={photo.url_medium} alt="" draggable={false} className="block h-auto w-full"
                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setImgAspect(i.naturalWidth / i.naturalHeight); }} />
              <div aria-label="Área de recorte" className="absolute cursor-move border-2 border-primary shadow-[0_0_0_9999px_hsl(var(--background)/0.6)]"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={(e) => onDown(e, "move")}>
                <div aria-label="Redimensionar recorte" className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm bg-primary" onPointerDown={(e) => onDown(e, "resize")} />
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setCrop(s.ratio === "livre" ? { x: 0, y: 0, w: 1, h: 1 } : fitCrop(ratio, imgAspect))}>Foto inteira</Button>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Proporção</p>
              <Seg value={s.ratio} options={RATIOS} onChange={(v) => set({ ratio: v })} />
              <p className="pt-2 font-medium">Dimensão final (lado maior)</p>
              <Seg value={s.size} options={[...SIZES.map((n) => ({ v: n as number | "custom", l: String(n) })), { v: "custom" as const, l: "Largura x altura" }]} onChange={(v) => set({ size: v })} />
              {s.size === "custom" && (
                <div className="flex items-center gap-2 pt-1">
                  <Input type="number" min={100} max={4096} className="w-24" aria-label="Largura" value={s.width} onChange={(e) => set({ width: Number(e.target.value) || 100 })} />×
                  <Input type="number" min={100} max={4096} className="w-24" aria-label="Altura" value={s.height} onChange={(e) => set({ height: Number(e.target.value) || 100 })} />
                </div>
              )}
              <p className="pt-2 font-medium">Encaixe</p>
              <Seg value={s.fit} options={[{ v: "cover", l: "Cortar para preencher" }, { v: "contain", l: "Encaixar inteira com fundo" }]} onChange={(v) => set({ fit: v, ...(v === "cover" && transparent ? { background: "#ffffff" } : {}) })} />
              {s.fit === "contain" && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span>Fundo:</span>
                  <input type="color" aria-label="Cor do fundo" value={transparent ? "#ffffff" : s.background} onChange={(e) => set({ background: e.target.value })} className="h-8 w-10" />
                  <Button type="button" size="sm" variant={transparent ? "default" : "outline"} onClick={() => set({ background: transparent ? "#ffffff" : "transparent" })}>Transparente</Button>
                </div>
              )}
              <p className="pt-2 font-medium">Tipo de arquivo</p>
              <Seg value={s.format} options={[{ v: "webp", l: "WebP" }, { v: "jpeg", l: "JPG", off: transparent }, { v: "png", l: "PNG" }]} onChange={(v) => set({ format: v })} />
              {transparent && <p className="text-xs text-muted-foreground">JPG não tem transparência.</p>}
              <p className="pt-2 font-medium">Peso máximo (KB)</p>
              <Input type="number" min={10} max={10000} className="w-28" aria-label="Peso máximo em KB" placeholder="sem limite"
                value={s.maxKb ?? ""} onChange={(e) => set({ maxKb: e.target.value === "" ? null : Number(e.target.value) })} />
              {s.format === "png" && <p className="text-xs text-muted-foreground">PNG não tem controle de peso.</p>}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Prévia</p>
            <div className="relative flex aspect-square w-full items-center justify-center rounded border bg-[repeating-conic-gradient(hsl(var(--muted))_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
              {res?.data_url && <img src={res.data_url} alt="Prévia da foto editada" className="max-h-full max-w-full object-contain" />}
              {loadingPrev && <Loader2 className="absolute h-6 w-6 animate-spin text-muted-foreground" />}
            </div>
            {res && <p className="text-sm font-semibold">{resultLine(res)}</p>}
            {warnings.map((w) => <p key={w} className="rounded border border-destructive/50 p-2 text-xs text-destructive">{w}</p>)}
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !!err}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar como nova foto</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
