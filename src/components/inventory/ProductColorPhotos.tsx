import { Component, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Loader2, Trash2, Plus, Sparkles, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAiPhotoJobs } from "@/hooks/useAiPhotoJobs";
import { AiPhotoDialog } from "./AiPhotoDialog";
import { toast } from "sonner";
import { useProductColorPhotosMode } from "@/hooks/useProductColorPhotosMode";
import { reorderPositions, validatePhotoFile } from "@/lib/productPhotos";
import { buildPhotoBlocks, deleteColorPhoto, loadColorPhotoData, photoSessionToken as token, photosForColorBlock, uploadAndSaveColorPhoto, type PhotoRow } from "@/lib/productColorPhotoBlocks";

export type { PhotoRow } from "@/lib/productColorPhotoBlocks";
export { buildPhotoBlocks, photosForColorBlock } from "@/lib/productColorPhotoBlocks";
interface Props { masterId: string; variantColors: string[]; }

class Boundary extends Component<{ children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() { return this.state.err ? <p className="text-xs text-destructive">Fotos por cor indisponíveis no momento.</p> : this.props.children; }
}

export function ProductColorPhotos(props: Props) {
  const { data } = useProductColorPhotosMode(!!props.masterId);
  if (!data?.visible) return null;
  return <Boundary><Inner {...props} /></Boundary>;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) { const item = q.shift(); if (item !== undefined) await fn(item); }
  }));
}

function Inner({ masterId, variantColors }: Props) {
  const [codes, setCodes] = useState<{ color: string | null; color_key: string | null }[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, string[]>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const dragFrom = useRef<{ key: string; idx: number } | null>(null);
  const [aiBlock, setAiBlock] = useState<{ key: string; label: string } | null>(null);
  const canUpload = useQuery({ queryKey: ["can_upload_product_photos"], staleTime: 5 * 60_000, queryFn: async () => {
    const { data } = await supabase.rpc("can_upload_product_photos" as any); return data === true;
  } });
  const photosRef = useRef<PhotoRow[]>([]);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const r = await loadColorPhotoData(masterId);
      if (off) return;
      if (r.error) toast.error("Erro ao carregar fotos por cor");
      setCodes(r.codes);
      setPhotos(r.photos);
      setLoading(false);
    })();
    return () => { off = true; };
  }, [masterId]);

  const blocks = useMemo(() => buildPhotoBlocks(variantColors, codes), [variantColors, codes]);
  photosRef.current = photos;
  const ai = useAiPhotoJobs(masterId,
    (key) => photosForColorBlock(photosRef.current, key, blocks).reduce((m, x) => Math.max(m, x.position + 1), 0),
    (rows) => { setPhotos((p) => [...p, ...rows.filter((r) => !p.some((x) => x.id === r.id))]); toast.success(`${rows.length} foto(s) da IA salva(s)`); });

  async function onFiles(key: string, label: string, files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    const bad = list.map((f) => [f, validatePhotoFile(f)] as const).filter(([, e]) => e);
    bad.forEach(([f, e]) => toast.error(`${f.name}: ${e}`));
    const ok = list.filter((f) => !validatePhotoFile(f));
    if (!ok.length) return;
    setProgress((p) => ({ ...p, [key]: ok.map((f) => f.name) }));
    let t: string;
    try { t = await token(); } catch (e: any) { toast.error(e.message); setProgress((p) => ({ ...p, [key]: [] })); return; }
    let sent = 0;
    await pool(ok, 3, async (f) => {
      try {
        const pos = photosForColorBlock(photos, key, blocks).length + sent;
        const row = await uploadAndSaveColorPhoto(f, masterId, key, label, pos, t);
        sent++;
        setPhotos((p) => [...p, row]);
      } catch (e: any) { toast.error(`${f.name}: ${e.message}`); }
      finally { setProgress((p) => ({ ...p, [key]: (p[key] || []).filter((n) => n !== f.name) })); }
    });
    if (sent) toast.success(`${sent} foto(s) salva(s) em ${label}`);
  }

  async function onDelete(ph: PhotoRow) {
    if (!confirm("Excluir esta foto?")) return;
    try {
      await deleteColorPhoto(ph);
      setPhotos((p) => p.filter((x) => x.id !== ph.id));
      toast.success("Foto excluída");
    } catch (e: any) { toast.error(e.message); }
  }

  async function onDrop(key: string, to: number) {
    const from = dragFrom.current; dragFrom.current = null;
    if (!from || from.key !== key || from.idx === to) return;
    const list = photosForColorBlock(photos, key, blocks);
    const next = reorderPositions(list, from.idx, to);
    const reorderedIds = new Set(list.map((photo) => photo.id));
    setPhotos((p) => [...p.filter((photo) => !reorderedIds.has(photo.id)), ...next]);
    const changed = next.filter((n) => list.find((o) => o.id === n.id)?.position !== n.position);
    const res = await Promise.all(changed.map((n) => supabase.from("product_color_photos").update({ position: n.position }).eq("id", n.id)));
    if (res.some((r) => r.error)) toast.error("Não consegui salvar a nova ordem"); else toast.success("Ordem salva");
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Fotos por cor</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> :
          blocks.length === 0 ? <p className="text-sm text-muted-foreground">Salve as variações com cor para cadastrar fotos.</p> :
          blocks.map(({ key, label }) => {
            const list = photosForColorBlock(photos, key, blocks);
            const busy = (progress[key] || []).length;
            return (
              <div key={key} className={`flex min-w-0 items-start gap-2${key === "geral" ? " md:col-span-2" : ""}`}>
                <div className="w-20 shrink-0 pt-1">
                  <p className="truncate text-sm font-medium" title={label}>{label}</p>
                  <span className="text-xs text-muted-foreground">({list.length})</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                  {list.map((ph, i) => (
                    <div key={ph.id} draggable onDragStart={() => (dragFrom.current = { key, idx: i })}
                      onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(key, i)}
                      className="relative h-14 w-14 shrink-0 rounded border overflow-hidden bg-muted cursor-move group">
                      <Button type="button" variant="ghost" className="h-14 w-14 p-0" aria-label={`Ampliar foto de ${label}`} onClick={() => setPreview(ph.url_medium)}>
                        <img src={ph.url_thumb} loading="lazy" width={56} height={56} alt={label} className="h-14 w-14 object-cover" />
                      </Button>
                      {ph.source === "ia" && <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-primary px-1 text-[9px] font-bold text-primary-foreground">IA</span>}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between bg-background/80 opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                        <Button asChild size="icon" variant="ghost" className="pointer-events-auto h-6 w-7">
                          <a href={ph.url_full} download target="_blank" rel="noreferrer" title="Baixar" aria-label={`Baixar foto de ${label}`}><Download className="h-3.5 w-3.5" /></a>
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="pointer-events-auto h-6 w-7 text-destructive" onClick={() => onDelete(ph)} title="Excluir" aria-label={`Excluir foto de ${label}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                  <label title={`Enviar fotos de ${label}`} aria-label={`Enviar fotos de ${label}`} className="h-14 w-14 shrink-0 rounded border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-muted text-[10px]">
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin" />{busy} enviando</> : <Plus className="h-5 w-5" />}
                    <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" disabled={!!busy}
                      onChange={(e) => { onFiles(key, label, e.target.files); e.target.value = ""; }} />
                  </label>
                  {canUpload.data && list.length > 0 && (() => {
                    const running = ai.jobs.some((j) => j.color === key && ["fila", "enviando", "gerando"].includes(j.status));
                    return (
                      <Button type="button" variant="outline" disabled={running} onClick={() => setAiBlock({ key, label })}
                        className="h-14 w-14 shrink-0 flex-col gap-0 p-0 text-[10px]" title={`Gerar com IA (${label})`} aria-label={`Gerar com IA (${label})`}>
                        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{running ? "gerando…" : "IA"}
                      </Button>
                    );
                  })()}
                  {ai.jobs.filter((j) => j.color === key).map((j) => {
                    const st: Record<string, string> = { fila: "na fila", enviando: "enviando", gerando: "gerando…", concluido: `pronto: ${j.saved ?? 0} salva(s)`, falhou: "falhou", expirado: "não terminou; reabra o produto mais tarde", erro: "erro" };
                    const bad = j.status === "falhou" || (j.failed ?? 0) > 0;
                    return (
                      <div key={j.job_id} className={`flex min-h-14 max-w-[220px] items-start gap-1 rounded border p-2 text-[11px] ${bad ? "border-destructive text-destructive" : ""}`}>
                        {["fila", "enviando", "gerando"].includes(j.status) && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">IA: {st[j.status]}</p>
                          {!!j.failed && <p>{j.failed} foto(s) falharam</p>}
                          {j.error && <p className="break-words">{j.error}</p>}
                        </div>
                        {!["fila", "enviando", "gerando"].includes(j.status) && (
                          <button type="button" aria-label="Fechar aviso" onClick={() => ai.dismiss(j.job_id)}><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        {aiBlock && (
          <AiPhotoDialog open={!!aiBlock} onOpenChange={(v) => !v && setAiBlock(null)} masterId={masterId}
            colorKey={aiBlock.key} label={aiBlock.label} getToken={token}
            sources={photosForColorBlock(photos, aiBlock.key, blocks)}
            onStarted={(job_id) => ai.track({ job_id, master: masterId, color: aiBlock.key, label: aiBlock.label, started_at: Date.now() })} />
        )}
        <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>Foto</DialogTitle></DialogHeader>
            {preview && <img src={preview} className="w-full h-auto" alt="" />}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
