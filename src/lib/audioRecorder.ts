/**
 * Audio recording utilities.
 *
 * We prefer `audio/ogg;codecs=opus` because:
 * - Meta WhatsApp API requires real OGG files (rejects WebM bytes with OGG mime)
 * - Z-API accepts both OGG and WebM
 * - Chrome & Firefox support OGG+Opus via MediaRecorder
 *
 * Falls back to `audio/webm;codecs=opus` (Safari) then default.
 */

const PREFERRED_MIME_TYPES = [
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/webm',
];

export function getAudioMimeType(): string {
  for (const mime of PREFERRED_MIME_TYPES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';  // let browser choose default
}

export function getAudioExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('webm')) return 'webm';
  return 'webm'; // fallback
}

export function getAudioContentType(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'audio/ogg';
  if (mimeType.includes('webm')) return 'audio/webm';
  return 'audio/webm';
}
