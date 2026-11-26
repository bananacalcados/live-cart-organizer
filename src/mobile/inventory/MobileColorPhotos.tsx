import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Download, Images, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAiPhotoJobs } from "@/hooks/useAiPhotoJobs";
import { AiPhotoDialog } from "@/components/inventory/AiPhotoDialog";
import { validatePhotoFile } from "@/lib/productPhotos";
import { isAcceptedPhotoType, MOBILE_FORMAT_ERROR, resizeForUpload } from "@/lib/photoResize";
import { buildPhotoBlocks, deleteColorPhoto, loadColorPhotoData, photoSessionToken, photosForColorBlock, uploadAndSaveColorPhoto, type PhotoRow } from "@/lib/productColorPhotoBlocks";

const RUNNING = ["fila", "enviando", "gerando"];

/** Fotos por cor na ficha do celular: só para quem pode enviar fotos (quem chama já respeita product_color_photos_mode). */
export function MobileColorPhotos({ masterId, variantColors }: { masterId: string; variantColors: string[] }) {
  const canUpload = useQuery({ queryKey: ["can_upload_product_photos"], staleTime: 5 * 60_000, queryFn: async () => {
    const { data } = await supabase.rpc("can_upload_product_photos" as any); return data === true;
  } });
  if (!canUpload.data) return null;
  return <Inner masterId={masterId} variantColors={variantColors} />;
}

function Inner({ masterId, variantColors }: { masterId: string; variantColors: string[] }) {
  const [codes, setCodes] = useState<{ color: string | null; color_key: string | null }[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, { name: string; step: string }[]>>({});
  const [preview, setPreview] = useState<PhotoRow | null>(null);
  const [aiBlock, setAiBlock] = useState<{ key: string; label: string } | null>(null);
  const photosRef = useRef<PhotoRow[]>([]);
  photosRef.current = photos;

  useEffect(() => {
    let off = false;
    loadColorPhotoData(masterId).then((r) => {
      if (off) return;
      if (r.error) toast.error("Erro ao carregar fotos por cor");
      setCodes(r.codes); setPhotos(r.photos); setLoading(false);
    });
    return () => { off = true; };
  }, [masterId]);

  const blocks = useMemo(() => buildPhotoBlocks(variantColors, codes), [variantColors, codes]);
  const ai = useAiPhotoJobs(masterId,
    (key) => photosForColorBlock(photosRef.current, key, blocks).reduce((m, x) => Math.max(m, x.position + 1), 0),
    (rows) => { setPhotos((p) => [...p, ...rows.filter((r) => !p.some((x) => x.id === r.id))]); toast.success(`${rows.length} foto(s) da IA salva(s)`); });

  const step = (key: string, name: string, s: string | null) => setProgress((p) => ({
    ...p, [key]: s === null ? (p[key] || []).filter((x) => x.name !== name) : [...(p[key] || []).filter((x) => x.name !== name), { name, step: s }],
  }));

  async function onFiles(key: string, label: string, files: FileList | null) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (list.some((f) => !isAcceptedPhotoType(f.type))) toast.error(MOBILE_FORMAT_ERROR);
    const ok = list.filter((f) => isAcceptedPhotoType(f.type));
    if (!ok.length) return;
    let t: string;
    try { t = await photoSessionToken(); } catch (e: any) { toast.error(e.message); return; }
    let sent = 0;
    for (const f of ok) {
      step(key, f.name, "reduzindo…");
      try {
        const small = await resizeForUpload(f);
        const err = validatePhotoFile(small);
        if (err) throw new Error(err);
        step(key, f.name, "enviando…");
        const pos = photosForColorBlock(photosRef.current, key, blocks).reduce((m, x) => Math.max(m, x.position + 1), 0);
        const row = await uploadAndSaveColorPhoto(small, masterId, key, label, pos, t);
        sent++;
        setPhotos((p) => [...p, row]);
      } catch (e: any) { toast.error(e.message || "Não consegui enviar a foto."); }
      finally { step(key, f.name, null); }
    }
    if (sent) toast.success(`${sent} foto(s) salva(s) em ${label}`);
  }

  async function onDelete(ph: PhotoRow) {
    if (!confirm("Excluir esta foto?")) return;
    try { await deleteColorPhoto(ph); setPhotos((p) => p.filter((x) => x.id !== ph.id)); setPreview(null); toast.success("Foto excluída"); }
    catch (e: any) { toast.error(e.message); }
  }

  if (loading) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />;
  return (
    <section className="space-y-3" aria-label="Fotos por cor">
      <h2 className="text-base font-bold">Fotos por cor</h2>
      {blocks.map(({ key, label }) => {
        const list = photosForColorBlock(photos, key, blocks);
        const busy = progress[key] || [];
        const running = ai.jobs.some((j) => j.color === key && RUNNING.includes(j.status));
        return (
          <div key={key} className="min-w-0 space-y-2 rounded-lg border bg-card p-3" data-testid={`bloco-${key}`}>
            <p className="font-medium">{label} <span className="text-xs text-muted-foreground">({list.length})</span></p>
            {list.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {list.map((ph) => (
                  <button key={ph.id} type="button" onClick={() => setPreview(ph)} aria-label={`Ampliar foto de ${label}`}
                    className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded bg-muted">
                    <img src={ph.url_thumb} loading="lazy" width={72} height={72} alt={label} className="h-[72px] w-[72px] object-cover" />
                    {ph.source === "ia" && <span className="absolute left-0.5 top-0.5 rounded bg-primary px-1 text-[9px] font-bold text-primary-foreground">IA</span>}
                  </button>
                ))}
              </div>
            )}
            {busy.map((b) => <p key={b.name} className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="min-w-0 truncate">{b.name}: {b.step}</span></p>)}
            {ai.jobs.filter((j) => j.color === key).map((j) => (
              <div key={j.job_id} className="flex items-center gap-2 rounded border p-2 text-xs">
                {RUNNING.includes(j.status) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span className="min-w-0 flex-1">IA: {RUNNING.includes(j.status) ? "gerando…" : j.status === "concluido" ? `pronto: ${j.saved ?? 0} salva(s)` : j.error || "não terminou"}</span>
                {!RUNNING.includes(j.status) && <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Fechar aviso" onClick={() => ai.dismiss(j.job_id)}><X className="h-4 w-4" /></Button>}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border bg-primary text-sm font-semibold text-primary-foreground">
                <Camera className="h-5 w-5" /> Tirar foto
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={!!busy.length}
                  onChange={(e) => { onFiles(key, label, e.target.files); e.target.value = ""; }} />
              </label>
              <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm font-semibold">
                <Images className="h-5 w-5" /> Galeria
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={!!busy.length}
                  onChange={(e) => { onFiles(key, label, e.target.files); e.target.value = ""; }} />
              </label>
            </div>
            {list.length > 0 && (
              <Button variant="outline" className="h-12 w-full" disabled={running} onClick={() => setAiBlock({ key, label })}>
                {running ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Sparkles className="mr-2 h-5 w-5" />} {running ? "Gerando…" : "Gerar com IA"}
              </Button>
            )}
          </div>
        );
      })}
      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-label="Foto ampliada">
          <div className="flex justify-end p-2"><Button variant="ghost" size="icon" className="h-12 w-12" aria-label="Fechar" onClick={() => setPreview(null)}><X className="h-6 w-6" /></Button></div>
          <img src={preview.url_medium} alt="" className="min-h-0 w-full flex-1 object-contain" />
          <div className="grid grid-cols-2 gap-2 p-4">
            <Button asChild variant="outline" className="h-12"><a href={preview.url_full} download target="_blank" rel="noreferrer"><Download className="mr-2 h-5 w-5" />Baixar</a></Button>
            <Button variant="destructive" className="h-12" onClick={() => onDelete(preview)}><Trash2 className="mr-2 h-5 w-5" />Excluir</Button>
          </div>
        </div>
      )}
      {aiBlock && (
        <AiPhotoDialog mobile open onOpenChange={(v) => !v && setAiBlock(null)} masterId={masterId} colorKey={aiBlock.key} label={aiBlock.label}
          getToken={photoSessionToken} sources={photosForColorBlock(photos, aiBlock.key, blocks)}
          onStarted={(job_id) => ai.track({ job_id, master: masterId, color: aiBlock.key, label: aiBlock.label, started_at: Date.now() })} />
      )}
    </section>
  );
}
