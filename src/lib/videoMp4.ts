/**
 * Normaliza vídeos do iPhone (QuickTime/.mov) para MP4 antes do upload/envio.
 *
 * Por que? A câmera do iPhone grava em container QuickTime (.mov), cujo box `ftyp`
 * traz o major brand "qt  ". A uazapi recusa esse arquivo com:
 *   "failed to process file: invalid video format. Only MP4 files are accepted"
 * O Android grava direto em MP4 (brand "mp42"/"isom"), por isso só o iPhone falha.
 *
 * O conteúdo de um .mov do iPhone já é H.264 + AAC — exatamente o que vai dentro de
 * um MP4. A única diferença que faz a uazapi recusar é o container/brand. Então, em
 * vez de transcodificar (pesado no mobile), reescrevemos APENAS o brand do box `ftyp`
 * de "qt  " para "mp42"/"isom", SEM mudar o tamanho do box. Manter o tamanho é
 * essencial: o MP4/MOV guarda offsets absolutos (stco/co64) que quebrariam se o
 * arquivo deslocasse qualquer byte.
 *
 * Importante: só toca em vídeos QuickTime/.mov. Qualquer outro arquivo (imagens,
 * vídeos MP4 do Android, áudios, documentos) é retornado sem alteração.
 */

const FTYP = [0x66, 0x74, 0x79, 0x70]; // "ftyp"
const QT_BRAND = [0x71, 0x74, 0x20, 0x20]; // "qt  "
const MP42 = [0x6d, 0x70, 0x34, 0x32]; // "mp42"
const ISOM = [0x69, 0x73, 0x6f, 0x6d]; // "isom"

function matchesAt(bytes: Uint8Array, offset: number, pattern: number[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (bytes[offset + i] !== pattern[i]) return false;
  }
  return true;
}

export function isIphoneMovVideo(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return mime === 'video/quicktime' || mime === 'video/x-quicktime' || ext === 'mov' || ext === 'qt';
}

export async function normalizeIphoneVideo(file: File): Promise<File> {
  if (!isIphoneMovVideo(file)) return file;

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());

    // O primeiro box do arquivo precisa ser o `ftyp`: [size:4][type:4="ftyp"]...
    // size está nos bytes 0-3, type ("ftyp") nos bytes 4-7.
    if (!matchesAt(buffer, 4, FTYP)) {
      // Sem ftyp no início: não mexe (evita corromper). Apenas relabela como mp4.
      return new File([file], renameToMp4(file.name), { type: 'video/mp4', lastModified: file.lastModified });
    }

    const ftypSize = (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
    const ftypEnd = Math.min(ftypSize > 0 ? ftypSize : buffer.length, buffer.length);

    // major_brand fica logo após o type (bytes 8-11).
    if (matchesAt(buffer, 8, QT_BRAND)) {
      buffer.set(MP42, 8);
    }

    // compatible_brands começam após minor_version (a partir do byte 16), em blocos de 4.
    // Troca qualquer "qt  " compatível por "isom" para passar checagens mais estritas,
    // mantendo o mesmo tamanho do box.
    for (let i = 16; i + 4 <= ftypEnd; i += 4) {
      if (matchesAt(buffer, i, QT_BRAND)) {
        buffer.set(ISOM, i);
      }
    }

    const blob = new Blob([buffer], { type: 'video/mp4' });
    return new File([blob], renameToMp4(file.name), { type: 'video/mp4', lastModified: file.lastModified });
  } catch (err) {
    console.warn('[videoMp4] Falha ao normalizar vídeo do iPhone, enviando original:', err);
    return file;
  }
}

function renameToMp4(name: string): string {
  const base = name.replace(/\.[^/.]+$/, '');
  return `${base || 'video'}.mp4`;
}
