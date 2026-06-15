import { useRef } from "react";
import { Image, Mic, Video, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type MediaType = 'image' | 'audio' | 'video' | 'document';

interface MediaAttachment {
  file: File;
  type: MediaType;
  previewUrl: string;
}

interface MediaAttachmentPickerProps {
  onMediaSelect: (attachment: MediaAttachment) => void;
  onCancel: () => void;
  selectedMedia: MediaAttachment | null;
  isUploading: boolean;
}

function getMediaType(file: File): MediaType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

// Formatos de imagem que o WhatsApp/uazapi aceitam diretamente.
const WHATSAPP_OK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];

/**
 * Normaliza imagens para um formato que o WhatsApp/uazapi consegue processar.
 *
 * Motivo do bug "Erro ao enviar mídia" em celulares:
 *  - iPhone tira fotos em HEIC/HEIF e grava vídeos em .mov; quando o navegador
 *    entrega esse arquivo cru, a uazapi tenta baixar a URL e falha com
 *    "failed to process file" → o app mostra "Erro ao enviar mídia".
 *  - Alguns Androids entregam imagens em webp.
 *
 * Aqui re-encodamos qualquer imagem que NÃO seja jpeg/png/gif para JPEG via
 * canvas (quando o navegador consegue decodificar). Se a decodificação falhar,
 * devolvemos o arquivo original (melhor tentar do que travar).
 */
async function normalizeImageForWhatsApp(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (WHATSAPP_OK_IMAGE_TYPES.includes(file.type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });

    if (!blob) return file;

    const baseName = (file.name || `foto-${Date.now()}`).replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (e) {
    console.warn('[normalizeImageForWhatsApp] não foi possível converter, enviando original:', e);
    return file;
  }
}

export function MediaAttachmentPicker({
  onMediaSelect,
  onCancel,
  selectedMedia,
  isUploading,
}: MediaAttachmentPickerProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = event.target.files?.[0];
    event.target.value = '';
    if (!rawFile) return;

    const { getMaxSizeForType, getMaxSizeLabel, getMediaTypeLabel } = await import('@/constants/mediaLimits');
    const maxSize = getMaxSizeForType(rawFile.type);
    if (rawFile.size > maxSize) {
      toast.error(`${getMediaTypeLabel(rawFile.type)} muito grande. O limite é ${getMaxSizeLabel(rawFile.type)}.`);
      return;
    }

    let file = rawFile;

    try {
      if (rawFile.type.startsWith('image/') && !WHATSAPP_OK_IMAGE_TYPES.includes(rawFile.type)) {
        toast.info('Convertendo imagem para um formato compatível...');
        file = await normalizeImageForWhatsApp(rawFile);
      }
    } catch (error) {
      console.error('Image conversion error:', error);
    }

    const type = getMediaType(file);
    const previewUrl = URL.createObjectURL(file);
    onMediaSelect({ file, type, previewUrl });
  };

  if (selectedMedia) {
    return (
      <div className="border-t bg-muted/40 p-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            {selectedMedia.type === 'image' && (
              <img
                src={selectedMedia.previewUrl}
                alt="Preview"
                className="h-16 w-16 rounded-lg object-cover"
              />
            )}
            {selectedMedia.type === 'video' && (
              <video
                src={selectedMedia.previewUrl}
                className="h-16 w-16 rounded-lg object-cover"
              />
            )}
            {selectedMedia.type === 'audio' && (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                <Mic className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            {isUploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-foreground/40">
                <Loader2 className="h-6 w-6 animate-spin text-background" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{selectedMedia.file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(selectedMedia.file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
          {!isUploading && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onCancel}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => imageInputRef.current?.click()}
      >
        <Image className="h-5 w-5 text-muted-foreground" />
      </Button>

      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => videoInputRef.current?.click()}
      >
        <Video className="h-5 w-5 text-muted-foreground" />
      </Button>

      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => audioInputRef.current?.click()}
      >
        <Mic className="h-5 w-5 text-muted-foreground" />
      </Button>
    </div>
  );
}

export async function uploadMediaToStorage(file: File): Promise<string | null> {
  try {
    const normalizedFile = await normalizeImageForWhatsApp(file);
    const rawExt = normalizedFile.name.split('.').pop();
    // Garante uma extensão válida mesmo quando a câmera entrega arquivo sem nome/extensão.
    const fileExt = rawExt && rawExt.length <= 5 && /^[a-z0-9]+$/i.test(rawExt)
      ? rawExt
      : (normalizedFile.type.split('/')[1] || 'bin');
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `chat/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, normalizedFile, {
        contentType: normalizedFile.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      toast.error('Erro ao fazer upload do arquivo');
      return null;
    }

    const { data } = supabase.storage
      .from('whatsapp-media')
      .getPublicUrl(filePath);

    return data.publicUrl;
  } catch (error) {
    console.error('Upload error:', error);
    toast.error('Erro ao fazer upload do arquivo');
    return null;
  }
}
