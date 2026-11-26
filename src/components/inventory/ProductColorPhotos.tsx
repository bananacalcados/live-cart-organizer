import { Component, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Loader2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useProductColorPhotosMode } from "@/hooks/useProductColorPhotosMode";
import { colorSlug, deletePhoto, reorderPositions, uploadPhoto, validatePhotoFile } from "@/lib/productPhotos";

interface PhotoRow { id: string; color_key: string; photo_id: string; url_thumb: string; url_medium: string; url_full: string; position: number; }
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

async function token() {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("Sessão expirada. Entre de novo.");
  return t;
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

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [c, p] = await Promise.all([
        supabase.from("product_color_codes").select("color,color_key").eq("master_id", masterId),
        supabase.from("product_color_photos").select("id,color_key,photo_id,url_thumb,url_medium,url_full,position").eq("master_id", masterId).order("position"),
      ]);
      if (off) return;
      if (p.error) toast.error("Erro ao carregar fotos por cor");
      setCodes(c.data || []);
      setPhotos((p.data as PhotoRow[]) || []);
      setLoading(false);
    })();
    return () => { off = true; };
  }, [masterId]);

  const blocks = useMemo(() => {
    const m = new Map<string, string>();
    const labels = [...variantColors.filter(Boolean), ...codes.map((c) => c.color || "")].filter(Boolean);
    for (const label of labels) {
      const code = codes.find((c) => (c.color || "").trim().toLowerCase() === label.trim().toLowerCase());
      const key = colorSlug(code?.color_key, label);
      if (!m.has(key)) m.set(key, label);
    }
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [variantColors, codes]);

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
        const up = await uploadPhoto(f, masterId, key, t);
        const pos = photos.filter((x) => x.color_key === key).length + sent;
        const { data: row, error } = await supabase.from("product_color_photos").insert({
          master_id: masterId, color_key: key, color: label, photo_id: up.id,
          url_thumb: up.thumb, url_medium: up.medium, url_full: up.full,
          width: up.width ?? null, height: up.height ?? null, position: pos,
        }).select("id,color_key,photo_id,url_thumb,url_medium,url_full,position").single();
        if (error) { await deletePhoto(up.id, t).catch(() => {}); throw new Error("Não consegui salvar o link da foto."); }
        sent++;
        setPhotos((p) => [...p, row as PhotoRow]);
      } catch (e: any) { toast.error(`${f.name}: ${e.message}`); }
      finally { setProgress((p) => ({ ...p, [key]: (p[key] || []).filter((n) => n !== f.name) })); }
    });
    if (sent) toast.success(`${sent} foto(s) salva(s) em ${label}`);
  }

  async function onDelete(ph: PhotoRow) {
    if (!confirm("Excluir esta foto?")) return;
    try {
      await deletePhoto(ph.photo_id, await token());
      const { error } = await supabase.from("product_color_photos").delete().eq("id", ph.id);
      if (error) throw new Error("Foto apagada no serviço, mas o link não saiu do ERP.");
      setPhotos((p) => p.filter((x) => x.id !== ph.id));
      toast.success("Foto excluída");
    } catch (e: any) { toast.error(e.message); }
  }

  async function onDrop(key: string, to: number) {
    const from = dragFrom.current; dragFrom.current = null;
    if (!from || from.key !== key || from.idx === to) return;
    const list = photos.filter((x) => x.color_key === key).sort((a, b) => a.position - b.position);
    const next = reorderPositions(list, from.idx, to);
    setPhotos((p) => [...p.filter((x) => x.color_key !== key), ...next]);
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
            const list = photos.filter((x) => x.color_key === key).sort((a, b) => a.position - b.position);
            const busy = (progress[key] || []).length;
            return (
              <div key={key} className="flex min-w-0 items-start gap-2">
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
                </div>
              </div>
            );
          })}
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
