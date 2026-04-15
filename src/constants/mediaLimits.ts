export const MEDIA_LIMITS = {
  IMAGE_MAX_SIZE: 16 * 1024 * 1024,      // 16MB
  VIDEO_MAX_SIZE: 64 * 1024 * 1024,      // 64MB
  DOCUMENT_MAX_SIZE: 64 * 1024 * 1024,   // 64MB
  AUDIO_MAX_SIZE: 64 * 1024 * 1024,      // 64MB
  AVATAR_MAX_SIZE: 5 * 1024 * 1024,      // 5MB
};

export function getMaxSizeForType(mimeType: string): number {
  if (mimeType.startsWith('image/')) return MEDIA_LIMITS.IMAGE_MAX_SIZE;
  if (mimeType.startsWith('video/')) return MEDIA_LIMITS.VIDEO_MAX_SIZE;
  if (mimeType.startsWith('audio/')) return MEDIA_LIMITS.AUDIO_MAX_SIZE;
  return MEDIA_LIMITS.DOCUMENT_MAX_SIZE;
}

export function getMaxSizeLabel(mimeType: string): string {
  const size = getMaxSizeForType(mimeType);
  return `${size / (1024 * 1024)}MB`;
}

export function getMediaTypeLabel(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'Imagem';
  if (mimeType.startsWith('video/')) return 'Vídeo';
  if (mimeType.startsWith('audio/')) return 'Áudio';
  return 'Arquivo';
}
