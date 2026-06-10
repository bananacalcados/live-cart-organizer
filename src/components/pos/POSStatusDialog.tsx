import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageIcon, Video, Type, Loader2, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { WhatsAppNumber } from "@/stores/whatsappNumberStore";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Todos os números da loja; o dialog filtra só os de provider uazapi. */
  numbers: WhatsAppNumber[];
}

type StatusType = "text" | "image" | "video";

/** Sobe a mídia no bucket whatsapp-media na pasta status/ (limpeza automática em 48h). */
async function uploadStatusMedia(file: File): Promise<string | null> {
  try {
    const ext = file.name.split(".").pop() || "bin";
    const day = new Date().toISOString().slice(0, 10);
    const path = `status/${day}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      console.error("upload status error:", error);
      toast.error("Erro ao subir a mídia");
      return null;
    }
    const { data } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.error("upload status error:", e);
    toast.error("Erro ao subir a mídia");
    return null;
  }
}

interface RecentStatus {
  message_id: string;
  type: string;
  media_url: string | null;
  caption: string | null;
  text_content: string | null;
  created_at: string;
}



export function POSStatusDialog({ open, onOpenChange, numbers }: Props) {
  const uazapiNumbers = useMemo(
    () => numbers.filter((n) => n.provider === "uazapi" && n.is_active),
    [numbers],
  );

  const [numberId, setNumberId] = useState<string>("");
  const [type, setType] = useState<StatusType>("image");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resolvedNumberId =
    numberId || (uazapiNumbers.length === 1 ? uazapiNumbers[0].id : "");

  // Status recentes (últimas 48h) da instância selecionada — para apagar status errados.
  const [recent, setRecent] = useState<RecentStatus[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    if (!resolvedNumberId) {
      setRecent([]);
      return;
    }
    setLoadingRecent(true);
    try {
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("whatsapp_status_posts")
        .select("message_id, type, media_url, caption, text_content, created_at")
        .eq("whatsapp_number_id", resolvedNumberId)
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      setRecent((data as RecentStatus[]) || []);
    } catch (e) {
      console.error("load recent status error:", e);
    } finally {
      setLoadingRecent(false);
    }
  }, [resolvedNumberId]);

  useEffect(() => {
    if (open) loadRecent();
  }, [open, loadRecent]);

  const handleDelete = async (s: RecentStatus) => {
    setDeletingId(s.message_id);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-delete-status", {
        body: { whatsapp_number_id: resolvedNumberId, message_id: s.message_id },
      });
      if (error) throw error;
      if (data?.success === false && !data?.localRemoved) {
        throw new Error(data?.error || "Falha ao apagar status");
      }
      toast.success("Status apagado");
      setRecent((prev) => prev.filter((r) => r.message_id !== s.message_id));
    } catch (e) {
      console.error("delete status error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao apagar status");
    } finally {
      setDeletingId(null);
    }
  };

  const reset = () => {
    setText("");
    setCaption("");
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  };

  const handlePublish = async () => {
    if (!resolvedNumberId) {
      toast.error("Selecione a instância uazapi");
      return;
    }
    if (type === "text" && !text.trim()) {
      toast.error("Escreva o texto do status");
      return;
    }
    if ((type === "image" || type === "video") && !file) {
      toast.error("Selecione a mídia do status");
      return;
    }

    setSending(true);
    try {
      let mediaUrl: string | null = null;
      if (type !== "text" && file) {
        mediaUrl = await uploadStatusMedia(file);
        if (!mediaUrl) {
          setSending(false);
          return;
        }
      }

      const { data, error } = await supabase.functions.invoke("uazapi-send-status", {
        body: {
          whatsapp_number_id: resolvedNumberId,
          type,
          text: type === "text" ? text.trim() : undefined,
          mediaUrl: mediaUrl || undefined,
          caption: type !== "text" ? caption.trim() || undefined : undefined,
        },
      });

      if (error) throw error;
      if (data?.success === false) throw new Error(data?.error || "Falha ao publicar status");

      toast.success("Status publicado! 🎉");
      reset();
      // Recarrega a lista para permitir apagar caso tenha publicado errado.
      setTimeout(loadRecent, 1500);
    } catch (e) {
      console.error("publish status error:", e);
      toast.error(e instanceof Error ? e.message : "Erro ao publicar status");
    } finally {
      setSending(false);
    }
  };

  const types: { key: StatusType; label: string; icon: typeof Type }[] = [
    { key: "image", label: "Foto", icon: ImageIcon },
    { key: "video", label: "Vídeo", icon: Video },
    { key: "text", label: "Texto", icon: Type },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publicar Status</DialogTitle>
        </DialogHeader>

        {uazapiNumbers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhuma instância uazapi disponível nesta loja. Status só funciona em instâncias uazapi.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Instância */}
            <div className="space-y-1.5">
              <Label>Instância</Label>
              <Select value={resolvedNumberId} onValueChange={setNumberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a instância" />
                </SelectTrigger>
                <SelectContent>
                  {uazapiNumbers.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.label} {n.phone_display ? `(${n.phone_display})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tipo */}
            <div className="flex gap-2">
              {types.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setType(key);
                    setFile(null);
                    if (preview) URL.revokeObjectURL(preview);
                    setPreview(null);
                  }}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1 rounded-lg border py-3 text-xs font-medium transition-colors",
                    type === key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Conteúdo */}
            {type === "text" ? (
              <Textarea
                placeholder="Escreva o texto do status..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
              />
            ) : (
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={type === "image" ? "image/*" : "video/*"}
                  className="hidden"
                  onChange={handlePickFile}
                />
                {preview ? (
                  <div className="relative">
                    {type === "image" ? (
                      <img src={preview} alt="prévia" className="w-full max-h-60 object-contain rounded-lg bg-muted" />
                    ) : (
                      <video src={preview} controls className="w-full max-h-60 rounded-lg bg-muted" />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (preview) URL.revokeObjectURL(preview);
                        setPreview(null);
                      }}
                      className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {type === "image" ? <ImageIcon className="h-4 w-4 mr-2" /> : <Video className="h-4 w-4 mr-2" />}
                    Selecionar {type === "image" ? "foto" : "vídeo"}
                  </Button>
                )}
                <Textarea
                  placeholder="Legenda (opcional)"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={2}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button
            onClick={handlePublish}
            disabled={sending || uazapiNumbers.length === 0}
          >
            {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Publicar Status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
