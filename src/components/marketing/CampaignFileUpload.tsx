import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Trash2, Image, FileText, Video, Mic, Loader2, FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const GENERAL_KEYWORD = "__geral__";

interface CampaignMedia {
  id: string;
  media_url: string;
  media_type: string;
  filename: string | null;
  send_mode: string;
  caption: string | null;
}

function getMediaType(file: File): string {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

function mediaIcon(type: string) {
  switch (type) {
    case 'image': return <Image className="h-4 w-4" />;
    case 'video': return <Video className="h-4 w-4" />;
    case 'audio': return <Mic className="h-4 w-4" />;
    default: return <FileText className="h-4 w-4" />;
  }
}

export default function CampaignFileUpload({ campaignId }: { campaignId: string }) {
  const [media, setMedia] = useState<CampaignMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchMedia();
  }, [campaignId]);

  const fetchMedia = async () => {
    const { data } = await supabase
      .from('ad_keyword_media')
      .select('id, media_url, media_type, filename, send_mode, caption')
      .eq('campaign_id', campaignId)
      .eq('keyword', GENERAL_KEYWORD)
      .maybeSingle();
    setMedia(data as CampaignMedia | null);
  };

  const handleUpload = async (file: File) => {
    if (file.size > 16 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 16MB.');
      return;
    }
    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `keyword-media/${campaignId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('marketing-attachments')
        .upload(filePath, file, { contentType: file.type, upsert: false });

      if (uploadError) { toast.error('Erro ao fazer upload'); return; }

      const { data: urlData } = supabase.storage
        .from('marketing-attachments')
        .getPublicUrl(filePath);

      if (media) {
        await supabase.from('ad_keyword_media').delete().eq('id', media.id);
      }

      const { data: inserted, error } = await supabase
        .from('ad_keyword_media')
        .insert({
          campaign_id: campaignId,
          keyword: GENERAL_KEYWORD,
          media_url: urlData.publicUrl,
          media_type: getMediaType(file),
          filename: file.name,
          send_mode: 'media_and_text',
        })
        .select('id, media_url, media_type, filename, send_mode, caption')
        .single();

      if (error) { toast.error('Erro ao salvar'); return; }
      setMedia(inserted as CampaignMedia);
      toast.success('Arquivo geral vinculado à campanha!');
    } catch { toast.error('Erro no upload'); } finally { setUploading(false); }
  };

  const removeMedia = async () => {
    if (!media) return;
    await supabase.from('ad_keyword_media').delete().eq('id', media.id);
    setMedia(null);
    toast.success('Arquivo removido');
  };

  const updateSendMode = async (mode: string) => {
    if (!media) return;
    await supabase.from('ad_keyword_media').update({ send_mode: mode }).eq('id', media.id);
    setMedia({ ...media, send_mode: mode });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1">
        <FileArchive className="h-3.5 w-3.5" />
        Arquivo / Catálogo da Campanha
      </Label>
      <p className="text-[11px] text-muted-foreground">
        Suba um PDF, imagem ou vídeo que será enviado automaticamente quando a campanha for ativada (ex: catálogo).
      </p>

      <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2">
        {media ? (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {mediaIcon(media.media_type)}
              <span className="truncate max-w-[200px]">{media.filename || 'arquivo'}</span>
            </div>
            <Select value={media.send_mode} onValueChange={updateSendMode}>
              <SelectTrigger className="h-7 text-[11px] w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="media_and_text">📎 Arquivo + Texto</SelectItem>
                <SelectItem value="media_only">📎 Só Arquivo</SelectItem>
                <SelectItem value="text_only">💬 Só Texto</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={removeMedia}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <input
              type="file"
              className="hidden"
              ref={fileRef}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = '';
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Enviando...</>
              ) : (
                <><Upload className="h-3.5 w-3.5 mr-1" /> Subir catálogo / arquivo</>
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
