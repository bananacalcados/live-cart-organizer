import { useState, useRef } from "react";
import { Image, Mic, Video, Paperclip, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

export function MediaAttachmentPicker({
  onMediaSelect,
  onCancel,
  selectedMedia,
  isUploading,
}: MediaAttachmentPickerProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (max 16MB for WhatsApp)
    if (file.size > 16 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 16MB.');
      return;
    }

    const type = getMediaType(file);
    const previewUrl = URL.createObjectURL(file);

    onMediaSelect({ file, type, previewUrl });

    // Reset input
    event.target.value = '';
  };

  if (selectedMedia) {
    return (
      <div className="p-3 bg-gray-100 border-t">
        <div className="flex items-center gap-3">
          <div className="relative">
            {selectedMedia.type === 'image' && (
              <img
                src={selectedMedia.previewUrl}
                alt="Preview"
                className="h-16 w-16 object-cover rounded-lg"
              />
            )}
            {selectedMedia.type === 'video' && (
              <video
                src={selectedMedia.previewUrl}
                className="h-16 w-16 object-cover rounded-lg"
              />
            )}
            {selectedMedia.type === 'audio' && (
              <div className="h-16 w-16 bg-gray-200 rounded-lg flex items-center justify-center">
                <Mic className="h-6 w-6 text-gray-500" />
              </div>
            )}
            {isUploading && (
              <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedMedia.file.name}</p>
            <p className="text-xs text-gray-500">
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
      {/* Image */}
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
        <Image className="h-5 w-5 text-gray-500" />
      </Button>

      {/* Video */}
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
        <Video className="h-5 w-5 text-gray-500" />
      </Button>

      {/* Audio */}
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
        <Mic className="h-5 w-5 text-gray-500" />
      </Button>
    </div>
  );
}

export async function uploadMediaToStorage(file: File): Promise<string | null> {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `chat/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, file);

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
