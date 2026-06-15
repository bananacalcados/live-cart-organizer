/**
 * Converte vídeos do iPhone (QuickTime/.mov) para um MP4 de verdade — compatível
 * com o WhatsApp/uazapi — direto no navegador, SEM ffmpeg/WASM.
 *
 * Por que NÃO usamos mais ffmpeg.wasm?
 *  - ffmpeg.wasm é instável em celular (principalmente iOS Safari/Chrome). O core
 *    falhava ao carregar ("failed to import ffmpeg-core.js") e, em vídeos maiores,
 *    estourava a memória. Ou seja: dependia de CDN + Worker + WASM, tudo frágil no
 *    aparelho do usuário.
 *
 * Como funciona agora (remux puro em JS — leve e confiável):
 *  - O .mov do iPhone e o .mp4 são, na prática, o MESMO formato (ISO Base Media
 *    File Format / "átomos"). A câmera grava H.264 ou HEVC dentro de um container
 *    QuickTime, com a tabela `moov` no FIM do arquivo e brand `qt  `.
 *  - O uazapi recusa `.mov` ("Only MP4 files are accepted") e o player do WhatsApp
 *    não abre quando o arquivo não é um MP4 limpo com "faststart" (moov no início).
 *  - Este remux:
 *      1) reescreve o `ftyp` para um brand de MP4 padrão (`isom`/`mp42`/`avc1`/`hvc1`);
 *      2) remove trilhas de metadata do iPhone (`mebx`/Core Media Metadata), que
 *         fazem o app oficial do WhatsApp exibir "há algo errado com o arquivo";
 *      3) move o `moov` para ANTES do `mdat` (faststart), corrigindo todos os
 *         offsets de chunk (`stco`/`co64`) pela diferença de posição;
 *      4) mantém só vídeo/áudio (H.264/HEVC + AAC) intactos — nada é re-encodado.
 *  - Resultado: um MP4 válido, faststart, que o uazapi aceita e o WhatsApp abre.
 *    Tudo em JS puro → funciona em qualquer dispositivo, sem rede/WASM.
 *
 * Só toca em vídeos QuickTime/.mov e MP4 escolhidos no iPhone. Vídeos MP4 do
 * Android, imagens, áudios e documentos NÃO passam por aqui.
 */

export function isIphoneMovVideo(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isQuickTime = mime === 'video/quicktime' || mime === 'video/x-quicktime' || ext === 'mov' || ext === 'qt';
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent || '');
  return isQuickTime || (isIOS && (mime === 'video/mp4' || mime === 'video/m4v' || ext === 'mp4' || ext === 'm4v'));
}

interface NormalizeOptions {
  /** Recebe progresso de 0 a 100 (aqui é praticamente instantâneo). */
  onProgress?: (percent: number) => void;
}

// ─── Leitura/escrita de inteiros big-endian ─────────────────────────────
function readU32(b: Uint8Array, o: number): number {
  return b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}
function readU64(b: Uint8Array, o: number): number {
  return readU32(b, o) * 0x100000000 + readU32(b, o + 4);
}
function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 255;
  b[o + 1] = (v >>> 16) & 255;
  b[o + 2] = (v >>> 8) & 255;
  b[o + 3] = v & 255;
}
function boxType(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
}
function writeType(b: Uint8Array, o: number, t: string): void {
  for (let i = 0; i < 4; i++) b[o + i] = t.charCodeAt(i);
}

interface TopBox {
  type: string;
  start: number;
  size: number;
  hdr: number;
}

function topBoxes(buf: Uint8Array): TopBox[] {
  const boxes: TopBox[] = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    let size = readU32(buf, pos);
    const t = boxType(buf, pos);
    let hdr = 8;
    if (size === 1) {
      size = readU64(buf, pos + 8);
      hdr = 16;
    } else if (size === 0) {
      size = buf.length - pos;
    }
    if (size < hdr || pos + size > buf.length) break;
    boxes.push({ type: t, start: pos, size, hdr });
    pos += size;
  }
  return boxes;
}

// Boxes "container" cujos filhos precisamos percorrer para achar stco/co64.
const CONTAINERS = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'dinf', 'mvex', 'moof', 'traf',
]);

function childBoxes(buf: Uint8Array, start: number, end: number): TopBox[] {
  const boxes: TopBox[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = readU32(buf, pos);
    const type = boxType(buf, pos);
    let hdr = 8;
    if (size === 1) {
      size = readU64(buf, pos + 8);
      hdr = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < hdr || pos + size > end) break;
    boxes.push({ type, start: pos, size, hdr });
    pos += size;
  }
  return boxes;
}

function findChild(buf: Uint8Array, parent: TopBox, type: string): TopBox | undefined {
  return childBoxes(buf, parent.start + parent.hdr, parent.start + parent.size).find((b) => b.type === type);
}

function handlerType(buf: Uint8Array, trak: TopBox): string | null {
  const mdia = findChild(buf, trak, 'mdia');
  if (!mdia) return null;
  const hdlr = findChild(buf, mdia, 'hdlr');
  if (!hdlr) return null;
  const o = hdlr.start + hdlr.hdr + 8; // version/flags + pre_defined
  if (o + 4 > hdlr.start + hdlr.size) return null;
  return String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
}

function sanitizeMoov(moov: Uint8Array): Uint8Array {
  const childStart = readU32(moov, 0) === 1 ? 16 : 8;
  const children = childBoxes(moov, childStart, moov.length);
  const kept: Uint8Array[] = [];
  let changed = false;

  for (const child of children) {
    if (child.type === 'trak') {
      const h = handlerType(moov, child);
      if (h && h !== 'vide' && h !== 'soun') {
        changed = true;
        continue;
      }
    }
    if (child.type === 'meta' || child.type === 'udta') {
      changed = true;
      continue;
    }
    kept.push(moov.slice(child.start, child.start + child.size));
  }

  if (!changed && childStart === 8) return moov;
  const size = 8 + kept.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  writeU32(out, 0, size);
  writeType(out, 4, 'moov');
  let o = 8;
  for (const part of kept) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

/**
 * Soma `delta` a todos os offsets de chunk (stco 32-bit e co64 64-bit) dentro do
 * intervalo [start, end) do buffer (que aqui é o próprio `moov`).
 */
function patchChunkOffsets(buf: Uint8Array, start: number, end: number, delta: number): void {
  let pos = start;
  while (pos + 8 <= end) {
    let size = readU32(buf, pos);
    const t = boxType(buf, pos);
    let hdr = 8;
    if (size === 1) {
      size = readU64(buf, pos + 8);
      hdr = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < hdr || pos + size > end) break;

    if (t === 'stco') {
      const base = pos + hdr; // version(1)+flags(3)
      const count = readU32(buf, base + 4);
      let o = base + 8;
      for (let i = 0; i < count; i++) {
        writeU32(buf, o, (readU32(buf, o) + delta) >>> 0);
        o += 4;
      }
    } else if (t === 'co64') {
      const base = pos + hdr;
      const count = readU32(buf, base + 4);
      let o = base + 8;
      for (let i = 0; i < count; i++) {
        const val = readU64(buf, o) + delta;
        const hi = Math.floor(val / 0x100000000);
        const lo = val >>> 0;
        writeU32(buf, o, hi);
        writeU32(buf, o + 4, lo);
        o += 8;
      }
    } else if (CONTAINERS.has(t)) {
      patchChunkOffsets(buf, pos + hdr, pos + size, delta);
    }

    pos += size;
  }
}

function bytesContainAscii(bytes: Uint8Array, text: string): boolean {
  const needle = [...text].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

function buildFtyp(includeHevc: boolean): Uint8Array {
  const brands = includeHevc ? ['isom', 'iso2', 'avc1', 'mp41', 'hvc1', 'mp42'] : ['isom', 'iso2', 'avc1', 'mp41', 'mp42'];
  const size = 8 + 4 + 4 + brands.length * 4;
  const b = new Uint8Array(size);
  writeU32(b, 0, size);
  b.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
  b.set([0x69, 0x73, 0x6f, 0x6d], 8); // major brand "isom"
  writeU32(b, 12, 0x200); // minor version
  let o = 16;
  for (const br of brands) {
    for (let i = 0; i < 4; i++) b[o + i] = br.charCodeAt(i);
    o += 4;
  }
  return b;
}

function remuxMovToMp4(input: Uint8Array): Uint8Array {
  const boxes = topBoxes(input);
  const moovBox = boxes.find((b) => b.type === 'moov');
  const mdatBox = boxes.find((b) => b.type === 'mdat');
  if (!moovBox || !mdatBox) {
    throw new Error('estrutura de vídeo inesperada (sem moov/mdat)');
  }

  // Cópia mutável do moov: removemos trilhas metadata do iPhone e corrigimos offsets.
  const originalMoov = input.slice(moovBox.start, moovBox.start + moovBox.size);
  const moov = sanitizeMoov(originalMoov);
  const newFtyp = buildFtyp(bytesContainAscii(moov, 'hvc1') || bytesContainAscii(moov, 'hev1'));
  const mdat = input.subarray(mdatBox.start, mdatBox.start + mdatBox.size);

  const newMdatStart = newFtyp.length + moov.length;
  const delta = newMdatStart - mdatBox.start;
  patchChunkOffsets(moov, 0, moov.length, delta);

  const out = new Uint8Array(newFtyp.length + moov.length + mdat.length);
  out.set(newFtyp, 0);
  out.set(moov, newFtyp.length);
  out.set(mdat, newFtyp.length + moov.length);
  return out;
}

function toMp4File(bytes: Uint8Array, originalName: string): File {
  // Garante um ArrayBuffer "puro" (evita SharedArrayBuffer no tipo do Blob).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: 'video/mp4' });
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

  options.onProgress?.(10);
  const input = new Uint8Array(await file.arrayBuffer());
  options.onProgress?.(60);
  const out = remuxMovToMp4(input);
  options.onProgress?.(100);
  return toMp4File(out, file.name);
}
