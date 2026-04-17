/**
 * Normaliza orientação EXIF de imagens antes do upload.
 *
 * Por que? Fotos tiradas no celular em modo retrato têm pixels gravados em paisagem
 * + flag EXIF "Orientation: 6" (rotacionar 90°). WhatsApp Business API descarta essa
 * flag ao reempacotar mídia para grupos, fazendo a foto chegar deitada.
 *
 * Solução: decodificar a imagem aplicando a rotação EXIF (createImageBitmap nativo),
 * desenhar em canvas e re-exportar como JPEG com pixels já orientados (EXIF removido).
 *
 * Vídeos, PDFs e áudios são retornados sem alteração.
 */

const MAX_DIMENSION = 1920; // limita dimensão para evitar arquivos enormes

export async function normalizeImageOrientation(file: File): Promise<File> {
  // Só processa imagens raster (JPEG/PNG/HEIC). SVG, GIF e não-imagens passam direto.
  if (!file.type.startsWith('image/')) return file;
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;

  try {
    // createImageBitmap com imageOrientation:'from-image' aplica a rotação EXIF.
    // Suportado em Chrome 81+, Firefox 77+, Safari 13.1+
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

    // Calcula dimensões finais (respeita MAX_DIMENSION)
    let { width, height } = bitmap;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) return file;

    // Renomeia para .jpg porque sempre exportamos como JPEG
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (err) {
    console.warn('[imageOrientation] Falha ao normalizar, enviando original:', err);
    return file;
  }
}
