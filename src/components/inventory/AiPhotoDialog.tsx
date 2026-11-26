import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AiError, DEFAULT_OPTIONS, FEATURED_RATIOS, applyPreset, buildGenerateBody, estimateCost, fetchLibrary,
  normalizeOptions, ptLabel, remainingToday, startGeneration, type AiOptions,
  fixFormat, type OutputFormat,
} from "@/lib/productPhotosAi";
import { AiPhotoPicker } from "./AiPhotoPicker";

interface Src { photo_id: string; url_thumb: string }
interface Props {
  open: boolean; onOpenChange: (v: boolean) => void;
  masterId: string; colorKey: string; label: string; sources: Src[];
  getToken: () => Promise<string>;
  onStarted: (jobId: string) => void;
}

function Seg<T extends string>({ value, options, onChange, disabled }: { value: T; options: { v: T; l: string; off?: boolean }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <Button key={o.v} type="button" size="sm" variant={value === o.v ? "default" : "outline"} disabled={disabled || o.off} onClick={() => onChange(o.v)}>{o.l}</Button>
      ))}
    </div>
  );
}

export function AiPhotoDialog({ open, onOpenChange, masterId, colorKey, label, sources, getToken, onStarted }: Props) {
  const qc = useQueryClient();
  const lib = useQuery({
    queryKey: ["ai_photo_library"], enabled: open, staleTime: 10 * 60_000, retry: false,
    queryFn: async () => fetchLibrary(await getToken()),
  });
  const presets = useQuery({
    queryKey: ["ai_photo_presets"], enabled: open, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("product_photo_ai_presets").select("id,name,options").order("name");
      if (error) throw error;
      return data || [];
    },
  });
  const [src, setSrc] = useState(sources[0]?.photo_id || "");
  const [o, setO] = useState<AiOptions>(DEFAULT_OPTIONS);
  const [gender, setGender] = useState<string>("");
  const [showRatios, setShowRatios] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const [badField, setBadField] = useState<string | null>(null);

  useEffect(() => { if (open) { setSrc(sources[0]?.photo_id || ""); setBadField(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const L = lib.data;
  const set = (p: Partial<AiOptions>) => setO((x) => fixFormat({ ...x, ...p }));
  const transparent = o.background.type === "transparent";
  const shoot = o.mode === "photoshoot";
  const cost = estimateCost(o);
  const left = L ? remainingToday(L) : 0;
  const pose = L?.poses.find((p) => p.id === o.pose_id);
  const distances = pose?.distances?.length ? (L?.camera_distance || []).filter((d) => pose.distances!.includes(d)) : L?.camera_distance || [];
  const genders = useMemo(() => [...new Set((L?.models || []).map((m) => m.gender).filter(Boolean) as string[])], [L]);
  const ratios = L?.ratios || FEATURED_RATIOS;
  const shownRatios = showRatios ? ratios : ratios.filter((r) => FEATURED_RATIOS.includes(r) || r === o.aspect_ratio);

  async function generate() {
    if (lock.current || !src) return;
    lock.current = true; setSending(true); setBadField(null);
    try {
      const res = await startGeneration(await getToken(), buildGenerateBody(masterId, colorKey, src, o));
      onStarted(res.job_id);
      toast.success(`Gerando ${label} (${res.custo_estimado} crédito(s)). Pode fechar.`);
      qc.invalidateQueries({ queryKey: ["ai_photo_library"] });
      onOpenChange(false);
    } catch (e: any) {
      if (e instanceof AiError && e.field) setBadField(e.field);
      toast.error(e.message || "Não consegui iniciar a geração.");
    } finally { lock.current = false; setSending(false); }
  }

  async function savePreset() {
    const name = presetName.trim().slice(0, 60);
    if (!name) return;
    const { error } = await supabase.from("product_photo_ai_presets").insert({ name, options: normalizeOptions(o) as any });
    if (error) { toast.error(error.code === "23505" ? "Já existe um kit com esse nome." : "Não consegui salvar o kit."); return; }
    setPresetName(""); toast.success("Kit salvo"); qc.invalidateQueries({ queryKey: ["ai_photo_presets"] });
  }
  function usePreset(id: string) {
    const p = presets.data?.find((x: any) => x.id === id);
    if (!p || !L) return;
    const r = applyPreset(p.options, L);
    setO(r.options);
    if (r.dropped.length) toast.warning(`Kit aplicado; não existem mais: ${r.dropped.join(", ")}.`); else toast.success("Kit aplicado");
  }
  async function deletePreset(id: string) {
    if (!confirm("Excluir este kit?")) return;
    const { error } = await supabase.from("product_photo_ai_presets").delete().eq("id", id);
    if (error) toast.error("Não consegui excluir o kit."); else qc.invalidateQueries({ queryKey: ["ai_photo_presets"] });
  }

  const sec = (f: string) => `space-y-2 rounded-md border p-3${badField === f ? " border-destructive" : ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col p-0">
        <DialogHeader className="px-4 pt-4"><DialogTitle>Gerar com IA · {label}</DialogTitle></DialogHeader>
        {lib.isLoading ? <div className="p-8"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div> :
         lib.error || !L ? <p className="p-4 text-sm text-destructive">{(lib.error as any)?.message || "Biblioteca da IA indisponível."}</p> : (
        <>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {!!presets.data?.length && (
            <div className="flex flex-wrap gap-1">
              {presets.data.map((p: any) => (
                <span key={p.id} className="inline-flex items-center rounded border">
                  <Button type="button" size="sm" variant="ghost" onClick={() => usePreset(p.id)}>{p.name}</Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-7 text-destructive" aria-label={`Excluir kit ${p.name}`} onClick={() => deletePreset(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </span>
              ))}
            </div>
          )}
          <div className={sec("source_photo_id")}>
            <Label>Foto de origem</Label>
            <div className="flex flex-wrap gap-2">
              {sources.map((s) => (
                <button type="button" key={s.photo_id} onClick={() => setSrc(s.photo_id)} className={`h-14 w-14 overflow-hidden rounded border ${src === s.photo_id ? "ring-2 ring-primary" : ""}`}>
                  <img src={s.url_thumb} loading="lazy" alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
          <div className={sec("mode")}>
            <Label>Modo</Label>
            <Seg value={o.mode} onChange={(v) => set({ mode: v })} options={[{ v: "single_shots", l: "Fotos avulsas" }, { v: "photoshoot", l: "Ensaio de 4 fotos" }]} />
            {!shoot && <Seg value={String(o.image_count) as any} onChange={(v) => set({ image_count: Number(v) })} options={["1", "2", "3", "4"].map((v) => ({ v, l: `${v} foto${v === "1" ? "" : "s"}` }))} />}
          </div>
          <div className={sec("model")}>
            <Label>Modelo</Label>
            <Seg value={o.model.type} onChange={(v) => set({ model: v === "selected" ? { type: "selected", id: L.models[0]?.id || "" } : { type: v } as any })}
              options={[{ v: "none", l: "Sem modelo" }, { v: "automatic", l: "Automático" }, { v: "selected", l: "Escolher" }]} />
            {o.model.type === "selected" && (
              <>
                {!!genders.length && <Seg value={gender} onChange={setGender} options={[{ v: "", l: "Todos" }, ...genders.map((g) => ({ v: g, l: ptLabel(g) }))]} />}
                <AiPhotoPicker items={L.models} value={(o.model as any).id} filter={gender ? (m) => m.gender === gender : undefined}
                  onChange={(id) => id && set({ model: { type: "selected", id } })} />
              </>
            )}
          </div>
          {!shoot && o.model.type !== "none" && (
            <div className={sec("pose_id")}>
              <Label>Pose</Label>
              <AiPhotoPicker items={L.poses} value={o.pose_id} noneLabel="Nenhuma" onChange={(id) => set({ pose_id: id, camera_distance: undefined })} />
            </div>
          )}
          <div className={sec("background")}>
            <Label>Fundo</Label>
            <Seg value={o.background.type} onChange={(v) => set({ background: v === "color" ? { type: "color", color: "#FFFFFF" } : v === "background" ? { type: "background", id: L.backgrounds[0]?.id || "" } : { type: v } as any })}
              options={[{ v: "automatic", l: "Automático" }, { v: "transparent", l: "Transparente" }, { v: "color", l: "Cor" }, { v: "background", l: "Cenário salvo" }]} />
            {o.background.type === "color" && (
              <input type="color" aria-label="Cor do fundo" value={o.background.color} onChange={(e) => set({ background: { type: "color", color: e.target.value.toUpperCase() } })} className="h-9 w-16 rounded border" />
            )}
            {o.background.type === "background" && (
              <AiPhotoPicker items={L.backgrounds} value={(o.background as any).id} onChange={(id) => id && set({ background: { type: "background", id } })} />
            )}
          </div>
          <div className={sec("style_id")}>
            <Label>Estilo de fotografia</Label>
            <AiPhotoPicker items={L.styles} value={o.style_id} noneLabel="Nenhum" onChange={(id) => set({ style_id: id })} />
          </div>
          <div className={sec("aspect_ratio")}>
            <Label>Formato</Label>
            <div className="flex flex-wrap gap-1">
              {shownRatios.map((r) => <Button key={r} type="button" size="sm" variant={o.aspect_ratio === r ? "default" : "outline"} onClick={() => set({ aspect_ratio: r })}>{r}</Button>)}
              {ratios.length > shownRatios.length && <Button type="button" size="sm" variant="ghost" onClick={() => setShowRatios(true)}>mais</Button>}
            </div>
            <Seg value={o.resolution} onChange={(v) => set({ resolution: v })} options={[{ v: "1k", l: "1K" }, { v: "2k", l: "2K" }, { v: "4k", l: "4K", off: shoot }]} />
            <Label className="text-xs">Tipo de arquivo</Label>
            <Seg value={o.output_format || "jpeg"} onChange={(v) => set({ output_format: v as OutputFormat })}
              options={[{ v: "jpeg", l: "JPG", off: transparent }, { v: "png", l: "PNG" }, { v: "webp", l: "WebP" }]} />
            {transparent && <p className="text-xs text-muted-foreground">JPG não tem transparência.</p>}
          </div>
          {!shoot && (
            <Collapsible className="rounded-md border p-3">
              <CollapsibleTrigger className="text-sm font-medium">Avançado</CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2">
                {([["framing", "Enquadramento", L.framing], ["shadow", "Sombra", L.shadow], ["camera_distance", "Distância da câmera", distances]] as const).map(([f, l, vals]) => (
                  <div key={f} className={badField === f ? "rounded border border-destructive p-1" : ""}>
                    <Label className="text-xs">{l}</Label>
                    <Seg value={(o as any)[f] || ""} onChange={(v) => set({ [f]: v || undefined } as any)} options={[{ v: "", l: "Padrão" }, ...(vals || []).map((v) => ({ v, l: ptLabel(v) }))]} />
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
          <div className={sec("directions")}>
            <Label>Orientações</Label>
            <Textarea maxLength={2000} value={o.directions || ""} onChange={(e) => set({ directions: e.target.value })} placeholder="Ex.: luz de fim de tarde, sem reflexos" />
          </div>
          <div className="flex gap-2">
            <Input placeholder="Nome do kit" maxLength={60} value={presetName} onChange={(e) => setPresetName(e.target.value)} className="h-8" />
            <Button type="button" size="sm" variant="outline" disabled={!presetName.trim()} onClick={savePreset}>Salvar como kit</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm">
          <div>
            <p className="font-medium">Custo estimado: {cost} crédito(s)</p>
            <p className="text-xs text-muted-foreground">Saldo {L.credits} · hoje {L.daily_used}/{L.daily_limit}{cost > left ? " · limite do dia" : ""}</p>
          </div>
          <Button type="button" onClick={generate} disabled={sending || !src || cost > left}>
            {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}Gerar
          </Button>
        </div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
