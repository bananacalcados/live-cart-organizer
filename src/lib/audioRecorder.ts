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

function audioBufferToWavBytes(audioBuffer: AudioBuffer): ArrayBuffer {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const frameCount = audioBuffer.length;
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channels }, (_, index) => audioBuffer.getChannelData(index));
  let offset = 44;

  for (let sampleIndex = 0; sampleIndex < frameCount; sampleIndex++) {
    for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
      const sample = Math.max(-1, Math.min(1, channelData[channelIndex][sampleIndex] ?? 0));
      const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, pcm, true);
      offset += bytesPerSample;
    }
  }

  return buffer;
}

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

export async function convertAudioBlobToWav(blob: Blob): Promise<Blob> {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('Seu navegador não suporta conversão de áudio para o Instagram.');
  }

  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return new Blob([audioBufferToWavBytes(decoded)], { type: 'audio/wav' });
  } catch (error) {
    console.error('[audioRecorder] WAV conversion failed:', error);
    throw new Error('Não consegui converter o áudio gravado para um formato aceito pelo Instagram.');
  } finally {
    await audioContext.close();
  }
}
