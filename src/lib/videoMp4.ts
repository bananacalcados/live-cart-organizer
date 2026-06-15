/**
 * Converte vídeos do iPhone (QuickTime/.mov, frequentemente HEVC/H.265) para um
 * MP4 H.264 de verdade — compatível com o WhatsApp — direto no navegador.
 *
 * Por que precisa transcodificar (e não só renomear/trocar o "brand")?
 *  - A câmera do iPhone grava em container QuickTime (.mov). No modo "Alta eficiência"
 *    o codec é HEVC (H.265), que o WhatsApp não reproduz. Mesmo no modo "Compatível"
 *    (H.264), o container .mov com moov no fim faz o player oficial da Meta recusar
 *    com "este vídeo não está disponível / algo errado com o arquivo".
 *  - A tentativa anterior apenas reescrevia os bytes do box `ftyp` (brand qt → mp42).
 *    Isso enganava a validação da uazapi (o upload passava), mas gerava um arquivo
 *    que o WhatsApp não conseguia decodificar de fato. Por isso o vídeo "ia", mas
 *    não abria no outro aparelho.
 *
 * Solução: usar ffmpeg.wasm para RE-ENCODAR para H.264 baseline + yuv420p + AAC com
 * `+faststart` (moov no início). Isso garante reprodução universal no WhatsApp.
 *
 * Importante: só toca em vídeos QuickTime/.mov (iPhone). Vídeos MP4 do Android,
 * imagens, áudios e documentos NÃO passam por aqui.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Core single-thread (não exige cross-origin isolation → funciona no iOS Safari).
const CORE_VERSION = '0.12.6';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let ffmpegSingleton: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  return loadPromise;
}

export function isIphoneMovVideo(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return mime === 'video/quicktime' || mime === 'video/x-quicktime' || ext === 'mov' || ext === 'qt';
}

interface NormalizeOptions {
  /** Recebe progresso de 0 a 100 durante a conversão. */
  onProgress?: (percent: number) => void;
}

export async function normalizeIphoneVideo(
  file: File,
  options: NormalizeOptions = {},
): Promise<File> {
  if (!isIphoneMovVideo(file)) return file;

  const ffmpeg = await getFFmpeg();

  const progressHandler = ({ progress }: { progress: number }) => {
    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
    options.onProgress?.(pct);
  };
  ffmpeg.on('progress', progressHandler);

  const inputName = 'input.mov';
  const outputName = 'output.mp4';

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // H.264 baseline + yuv420p + AAC + faststart = máxima compatibilidade WhatsApp.
    // -crf 23 mantém boa qualidade; preset veryfast equilibra velocidade no mobile.
    await ffmpeg.exec([
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-profile:v', 'baseline',
      '-level', '3.1',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputName,
    ]);

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data as Uint8Array], { type: 'video/mp4' });
    if (blob.size === 0) throw new Error('saída de conversão vazia');

    const base = file.name.replace(/\.[^/.]+$/, '');
    return new File([blob], `${base || 'video'}.mp4`, {
      type: 'video/mp4',
      lastModified: Date.now(),
    });
  } finally {
    ffmpeg.off('progress', progressHandler);
    // Limpa arquivos do FS virtual para não acumular memória entre envios.
    try { await ffmpeg.deleteFile(inputName); } catch { /* noop */ }
    try { await ffmpeg.deleteFile(outputName); } catch { /* noop */ }
  }
}
