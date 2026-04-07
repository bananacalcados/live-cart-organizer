import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Trash2, Image, FileText, Video, Mic, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface KeywordMedia {
  id: string;
  campaign_id: string;
  keyword: string;
  media_url: string;
  media_type: string;
  filename: string | null;
  send_mode: string;
  caption: string | null;
}

interface KeywordMediaManagerProps {
  campaignId: string;
  keywords: string[];
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

export default function KeywordMediaManager({ campaignId, keywords }: KeywordMediaManagerProps) {
  const [mediaItems, setMediaItems] = useState<KeywordMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetchMedia();
  }, [campaignId]);

  const fetchMedia = async () => {
    const { data } = await supabase
      .from('ad_keyword_media')
      .select('*')
      .eq('campaign_id', campaignId);
    setMediaItems((data as any[]) || []);
    setLoading(false);
  };

  const handleFileUpload = async (keyword: string, file: File) => {
    if (file.size > 16 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 16MB.');
      return;
    }

    setUploading(keyword);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `keyword-media/${campaignId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('marketing-attachments')
        .upload(filePath, file, { contentType: file.type, upsert: false });

      if (uploadError) {
        toast.error('Erro ao fazer upload');
        return;
      }

      const { data: urlData } = supabase.storage
        .from('marketing-attachments')
        .getPublicUrl(filePath);

      const mediaType = getMediaType(file);

      // Remove existing media for this keyword first
      const existing = mediaItems.find(m => m.keyword === keyword);
      if (existing) {
        await supabase.from('ad_keyword_media').delete().eq('id', existing.id);
      }

      const { data: inserted, error } = await supabase
        .from('ad_keyword_media')
        .insert({
          campaign_id: campaignId,
          keyword,
          media_url: urlData.publicUrl,
          media_type: mediaType,
          filename: file.name,
          send_mode: 'media_and_text',
        })
        .select()
        .single();

      if (error) {
        toast.error('Erro ao salvar mídia');
        return;
      }

      setMediaItems(prev => [...prev.filter(m => m.keyword !== keyword), inserted as any]);
      toast.success(`Arquivo vinculado a "${keyword}"`);
    } catch (err) {
      toast.error('Erro no upload');
    } finally {
      setUploading(null);
    }
  };

  const removeMedia = async (mediaId: string, keyword: string) => {
    await supabase.from('ad_keyword_media').delete().eq('id', mediaId);
    setMediaItems(prev => prev.filter(m => m.id !== mediaId));
    toast.success(`Mídia removida de "${keyword}"`);
  };

  const updateSendMode = async (mediaId: string, mode: string) => {
    await supabase.from('ad_keyword_media').update({ send_mode: mode }).eq('id', mediaId);
    setMediaItems(prev => prev.map(m => m.id === mediaId ? { ...m, send_mode: mode } : m));
  };

  const updateCaption = async (mediaId: string, caption: string) => {
    await supabase.from('ad_keyword_media').update({ caption: caption || null }).eq('id', mediaId);
    setMediaItems(prev => prev.map(m => m.id === mediaId ? { ...m, caption } : m));
  };

  if (keywords.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1">
        <Paperclip className="h-3.5 w-3.5" />
        Arquivos por Palavra-chave
      </Label>
      <p className="text-[11px] text-muted-foreground">
        Vincule imagens, PDFs, vídeos ou áudios a cada keyword. A Jess enviará o arquivo quando a palavra-chave for ativada.
      </p>

      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {keywords.map(kw => {
          const media = mediaItems.find(m => m.keyword === kw);
          const isUploading = uploading === kw;

          return (
            <div key={kw} className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
              <Badge variant="outline" className="text-xs shrink-0 max-w-[120px] truncate">{kw}</Badge>

              {media ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    {mediaIcon(media.media_type)}
                    <span className="truncate max-w-[100px]">{media.filename || 'arquivo'}</span>
                  </div>
                  <Select value={media.send_mode} onValueChange={v => updateSendMode(media.id, v)}>
                    <SelectTrigger className="h-7 text-[11px] w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="media_and_text">📎 Arquivo + Texto</SelectItem>
                      <SelectItem value="media_only">📎 Só Arquivo</SelectItem>
                      <SelectItem value="text_only">💬 Só Texto</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => removeMedia(media.id, kw)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex-1">
                  <input
                    type="file"
                    className="hidden"
                    ref={el => { fileInputRefs.current[kw] = el; }}
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(kw, file);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    disabled={isUploading}
                    onClick={() => fileInputRefs.current[kw]?.click()}
                  >
                    {isUploading ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Enviando...</>
                    ) : (
                      <><Upload className="h-3.5 w-3.5 mr-1" /> Anexar arquivo</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
