import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Send, X } from "lucide-react";

export const MAX_MULTI_IMAGES = 10;

export interface MultiImageItem {
  id: string;
  file: File;
  previewUrl: string;
  caption: string;
}

export function makeMultiImageItems(files: File[]): MultiImageItem[] {
  return files.map((file, i) => ({
    id: `${Date.now()}-${i}-${file.name}`,
    file,
    previewUrl: URL.createObjectURL(file),
    caption: "",
  }));
}

interface Props {
  open: boolean;
  items: MultiImageItem[];
  onItemsChange: (items: MultiImageItem[]) => void;
  onCancel: () => void;
  /** Envia na ordem; deve resolver quando todas terminarem. */
  onConfirm: (items: MultiImageItem[], onProgress: (done: number) => void) => Promise<void>;
  /** Prepara arquivos adicionados (redimensionar, validar tamanho). */
  prepareFiles?: (files: File[]) => Promise<File[]>;
}

export function MultiImageSendDialog({ open, items, onItemsChange, onCancel, onConfirm, prepareFiles }: Props) {
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!items.find((i) => i.id === activeId)) setActiveId(items[0]?.id ?? null);
  }, [items, activeId]);

  const active = items.find((i) => i.id === activeId) || items[0];

  const remove = (id: string) => {
    const it = items.find((i) => i.id === id);
    if (it) URL.revokeObjectURL(it.previewUrl);
    const next = items.filter((i) => i.id !== id);
    onItemsChange(next);
    if (next.length === 0) onCancel();
  };

  const addMore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let files = Array.from(e.target.files || []);
    e.target.value = "";
    if (prepareFiles) files = await prepareFiles(files);
    const room = MAX_MULTI_IMAGES - items.length;
    onItemsChange([...items, ...makeMultiImageItems(files.slice(0, Math.max(0, room)))]);
  };

  const send = async () => {
    setSending(true);
    setDone(0);
    try {
      await onConfirm(items, setDone);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sending) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Conferir {items.length} foto(s) antes de enviar</DialogTitle>
        </DialogHeader>

        {active && (
          <div className="space-y-2">
            <div className="flex items-center justify-center bg-muted rounded-md h-72 overflow-hidden">
              <img src={active.previewUrl} alt="Pré-visualização" className="max-h-full max-w-full object-contain" />
            </div>
            <Textarea
              value={active.caption}
              onChange={(e) => onItemsChange(items.map((i) => (i.id === active.id ? { ...i, caption: e.target.value } : i)))}
              placeholder="Legenda desta foto (opcional)"
              rows={2}
              disabled={sending}
            />
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((it, idx) => (
            <div
              key={it.id}
              className={`relative shrink-0 w-16 h-16 rounded-md overflow-hidden border-2 cursor-pointer ${it.id === active?.id ? "border-primary" : "border-transparent"}`}
              onClick={() => setActiveId(it.id)}
            >
              <img src={it.previewUrl} alt="" className="w-full h-full object-cover" />
              <span className="absolute bottom-0 left-0 bg-background/80 text-[10px] px-1">{idx + 1}</span>
              {it.caption.trim() && <span className="absolute bottom-0 right-0 bg-primary text-primary-foreground text-[9px] px-1">Aa</span>}
              {!sending && (
                <button
                  type="button"
                  aria-label="Remover foto"
                  className="absolute top-0 right-0 bg-background/90 rounded-bl p-0.5"
                  onClick={(e) => { e.stopPropagation(); remove(it.id); }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {items.length < MAX_MULTI_IMAGES && !sending && (
            <button
              type="button"
              aria-label="Adicionar mais fotos"
              onClick={() => addRef.current?.click()}
              className="shrink-0 w-16 h-16 rounded-md border-2 border-dashed flex items-center justify-center text-muted-foreground"
            >
              <Plus className="h-5 w-5" />
            </button>
          )}
          <input ref={addRef} type="file" accept="image/*" multiple className="hidden" onChange={addMore} />
        </div>
        <p className="text-xs text-muted-foreground">Máximo {MAX_MULTI_IMAGES} fotos. Enviadas nesta ordem, com uma pequena pausa entre elas.</p>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={sending}>Cancelar</Button>
          <Button onClick={send} disabled={sending || items.length === 0}>
            {sending ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Enviando {done}/{items.length}</> : <><Send className="h-4 w-4 mr-1" /> Enviar {items.length}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
