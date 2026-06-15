/**
 * Converte vídeos do iPhone (QuickTime/.mov) para um MP4 de verdade — compatível
 * com o WhatsApp — direto no navegador.
 *
 * Por que precisa mexer (e não só renomear/trocar o "brand")?
 *  - A câmera do iPhone grava em container QuickTime (.mov), com a tabela `moov`
 *    no FIM do arquivo e átomos específicos da Apple. O uazapi recusa `.mov`
 *    ("Only MP4 files are accepted") e o player oficial da Meta recusa o arquivo
 *    quando ele não é um MP4 válido com faststart.
 *  - A tentativa antiga só reescrevia os bytes do box `ftyp` (brand qt → mp42).
 *    Isso enganava a validação do uazapi, mas gerava um arquivo que o WhatsApp
 *    não conseguia abrir de fato. Por isso o vídeo "ia", mas não abria.
 *  - A tentativa seguinte RE-ENCODAVA tudo (libx264) no celular. Isso estourava a
 *    memória do ffmpeg.wasm em vídeos grandes → "Não foi possível converter".
 *
 * Estratégia atual (robusta e leve):
 *  1) REMUX (cópia de stream): `-c copy -movflags +faststart`. Reembala o vídeo
 *     no container MP4 com o moov no início, SEM re-encodar. É rápido, usa pouca
 *     memória e funciona para a grande maioria (vídeos H.264 do iPhone). Mantém
 *     também HEVC dentro de um MP4 válido (versões atuais do WhatsApp reproduzem).
 *  2) FALLBACK: se o remux falhar, tenta re-encodar para H.264 baseline + AAC
 *     reduzindo a resolução (máx. 1280px) para caber na memória do celular.
 *
 * Só toca em vídeos QuickTime/.mov (iPhone). Vídeos MP4 do Android, imagens,
 * áudios e documentos NÃO passam por aqui.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Core single-thread (não exige cross-origin isolation → funciona no iOS Safari).
const CORE_VERSION = '0.12.6';
const CORE_BASES = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
];

let ffmpegSingleton: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
let lastLog = '';

async function loadFromBase(ffmpeg: FFmpeg, base: string): Promise<void> {
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  ]);
  await ffmpeg.load({ coreURL, wasmURL });
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      lastLog = message;
    });
    let lastErr: unknown = null;
    for (const base of CORE_BASES) {
      try {
        await loadFromBase(ffmpeg, base);
        ffmpegSingleton = ffmpeg;
        return ffmpeg;
      } catch (e) {
        lastErr = e;
      }
    }
    loadPromise = null;
    throw new Error(`Falha ao carregar conversor de vídeo: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
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

function toMp4File(bytes: Uint8Array, originalName: string): File {
  // Copia para um ArrayBuffer "puro" (evita SharedArrayBuffer no tipo do Blob).
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const blob = new Blob([buf], { type: 'video/mp4' });
  const base = originalName.replace(/\.[^/.]+$/, '');
  return new File([blob], `${base || 'video'}.mp4`, {
    type: 'video/mp4',
    lastModified: Date.now(),
  });
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

  const runAndRead = async (args: string[]): Promise<Uint8Array> => {
    try { await ffmpeg.deleteFile(outputName); } catch { /* noop */ }
    await ffmpeg.exec(args);
    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
    if (!bytes || bytes.byteLength === 0) throw new Error('saída de conversão vazia');
    return bytes;
  };

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // 1) REMUX (rápido e leve): só reembala no container MP4 com faststart.
    try {
      const bytes = await runAndRead([
        '-i', inputName,
        '-c', 'copy',
        '-movflags', '+faststart',
        outputName,
      ]);
      return toMp4File(bytes, file.name);
    } catch (remuxErr) {
      console.warn('[videoMp4] remux falhou, tentando re-encode reduzido:', remuxErr, lastLog);
    }

    // 2) FALLBACK: re-encode H.264 baseline reduzindo resolução p/ caber na memória.
    try {
      const bytes = await runAndRead([
        '-i', inputName,
        '-vf', "scale='min(1280,iw)':-2",
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '26',
        '-profile:v', 'baseline',
        '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputName,
      ]);
      return toMp4File(bytes, file.name);
    } catch (encErr) {
      const detail = (lastLog || (encErr instanceof Error ? encErr.message : String(encErr))).slice(0, 200);
      throw new Error(detail || 'falha na conversão');
    }
  } finally {
    ffmpeg.off('progress', progressHandler);
    // Limpa arquivos do FS virtual para não acumular memória entre envios.
    try { await ffmpeg.deleteFile(inputName); } catch { /* noop */ }
    try { await ffmpeg.deleteFile(outputName); } catch { /* noop */ }
  }
}
