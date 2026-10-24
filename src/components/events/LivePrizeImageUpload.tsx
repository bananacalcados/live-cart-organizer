import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function LivePrizeImageUpload({ eventId, value, onChange }: { eventId: string; value: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  async function upload(file: File) {
    const formats: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const ext = formats[file.type];
    if (!ext) { toast.error("Escolha uma foto JPG, PNG ou WebP."); return; }
    setUploading(true);
    try {
      const path = `${eventId}/prizes/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("event-landing-assets").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("event-landing-assets").getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success("Foto do prêmio enviada.");
    } catch { toast.error("Não foi possível enviar a foto. Tente novamente."); }
    finally { setUploading(false); if (input.current) input.current.value = ""; }
  }
  return <div className="space-y-2">
    <input ref={input} aria-label="Arquivo da foto do prêmio" className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
    <Button type="button" variant="outline" disabled={uploading} onClick={() => input.current?.click()} className="w-full">
      {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />} {uploading ? "Enviando foto…" : "Enviar foto do computador"}
    </Button>
    {value && <div className="flex items-start gap-2"><img src={value} alt="Foto do prêmio" className="h-32 w-32 rounded-md border bg-background object-contain" /><Button type="button" variant="ghost" size="icon" title="Remover foto" aria-label="Remover foto" disabled={uploading} onClick={() => onChange("")}><X className="h-4 w-4" /></Button></div>}
  </div>;
}