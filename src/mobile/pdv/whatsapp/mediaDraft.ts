import { getMaxSizeForType, getMaxSizeLabel } from '@/constants/mediaLimits';
export function mobileMediaKind(file: Pick<File, 'type'>) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}
export function mediaDraftError(file: Pick<File, 'type' | 'size'>) {
  // Images are resized by the existing desktop uploader before its size check.
  if (file.type.startsWith('image/') || file.size <= getMaxSizeForType(file.type)) return null;
  return `Arquivo muito grande. Limite ${getMaxSizeLabel(file.type)}.`;
}