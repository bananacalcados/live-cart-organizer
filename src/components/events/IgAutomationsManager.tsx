import { useRef, useState } from "react";
import { Plus, Trash2, Upload, Zap, Loader2, FileVideo, FileAudio, FileImage, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type IgAutomationMediaKind = "image" | "video" | "audio" | "file";

export interface IgAutomation {
  id: string;
  label: string;
  text?: string;
  media?: {
    kind: IgAutomationMediaKind;
    url: string;
    mimeType?: string;
  } | null;
}

interface Props {
  eventId: string | null;
  automations: IgAutomation[];
  onChange: (next: IgAutomation[]) => void;
}

// Limites (IG DM)
const MAX_SIZE: Record<IgAutomationMediaKind, number> = {
  image: 8 * 1024 * 1024,
  video: 25 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  file: 25 * 1024 * 1024,
};

function detectKind(mime: string): IgAutomationMediaKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

function iconFor(kind: IgAutomationMediaKind) {
  if (kind === "video") return <FileVideo className="h-4 w-4" />;
  if (kind === "audio") return <FileAudio className="h-4 w-4" />;
  if (kind === "image") return <FileImage className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

function slugify(label: string) {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "automacao";
}

function newAutomation(index: number, existing: IgAutomation[]): IgAutomation {
  const label = `Automação ${index}`;
  let base = `auto_${slugify(label)}`;
  let id = base;
  let n = 2;
  while (existing.some((a) => a.id === id)) {
    id = `${base}_${n++}`;
  }
  return { id, label, text: "", media: null };
}

export function IgAutomationsManager({ eventId, automations, onChange }: Props) {
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  const update = (id: string, patch: Partial<IgAutomation>) => {
    onChange(automations.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const add = () => onChange([...automations, newAutomation(automations.length + 1, automations)]);

  const remove = (id: string) => onChange(automations.filter((a) => a.id !== id));

  const handleFile = async (id: string, file: File) => {
    if (!eventId) {
      toast.error("Salve o evento antes de anexar mídia.");
      return;
    }
    const kind = detectKind(file.type || "");
    if (file.size > MAX_SIZE[kind]) {
      toast.error(`Arquivo muito grande. Limite: ${Math.round(MAX_SIZE[kind] / 1024 / 1024)}MB`);
      return;
    }
    setUploadingId(id);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `event-ig-automations/${eventId}/${id}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("chat-media")
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      update(id, { media: { kind, url: pub.publicUrl, mimeType: file.type || undefined } });
      toast.success("Mídia anexada.");
    } catch (e: any) {
      console.error("[IgAutomationsManager] upload failed", e);
      toast.error("Falha no upload: " + (e?.message || "desconhecido"));
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-purple-500/40 p-4 bg-purple-500/5">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 font-semibold">
          <Zap className="h-4 w-4 text-purple-500" />
          Automações do Instagram (mídia por botão)
        </Label>
        <Button type="button" variant="outline" size="sm" onClick={add} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Crie respostas prontas (texto + vídeo/imagem/áudio/arquivo). Depois vincule cada automação a um botão da mensagem inicial. Quando o cliente clicar no botão, essa mídia é enviada por DM.
      </p>

      {automations.length === 0 && (
        <div className="text-xs text-muted-foreground py-1">Nenhuma automação criada.</div>
      )}

      {automations.map((a, i) => (
        <div key={a.id} className="space-y-2 rounded-md border p-3 bg-background">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground shrink-0">#{i + 1}</span>
            <Input
              value={a.label}
              onChange={(e) => update(a.id, { label: e.target.value })}
              placeholder="Nome interno (ex.: Como finalizar compra)"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive shrink-0"
              onClick={() => remove(a.id)}
              title="Remover"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <Textarea
            value={a.text || ""}
            onChange={(e) => update(a.id, { text: e.target.value })}
            placeholder="Texto opcional que acompanha a mídia"
            className="min-h-[60px] text-xs"
          />

          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={(el) => (fileInputsRef.current[a.id] = el)}
              type="file"
              accept="image/*,video/*,audio/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(a.id, f);
                e.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={uploadingId === a.id || !eventId}
              onClick={() => fileInputsRef.current[a.id]?.click()}
              title={!eventId ? "Salve o evento antes de anexar mídia" : ""}
            >
              {uploadingId === a.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {a.media ? "Trocar mídia" : "Enviar mídia"}
            </Button>

            {a.media && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate max-w-[60%]">
                {iconFor(a.media.kind)}
                <a href={a.media.url} target="_blank" rel="noreferrer" className="underline truncate">
                  {a.media.kind} anexado
                </a>
                <button
                  type="button"
                  className="text-destructive underline ml-1"
                  onClick={() => update(a.id, { media: null })}
                >
                  remover
                </button>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground font-mono">
            ID do botão: <span className="bg-muted px-1 rounded">{a.id}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
