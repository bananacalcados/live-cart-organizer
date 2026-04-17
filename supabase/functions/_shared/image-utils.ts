/**
 * Helpers de processamento de imagem para Edge Functions (Deno).
 *
 * Foco: corrigir orientação EXIF de imagens vindas de celulares antes de enviar
 * via Z-API/WhatsApp para grupos. WhatsApp Business descarta a flag EXIF
 * "Orientation" ao reempacotar mídia, fazendo a foto chegar deitada.
 *
 * Solução server-side: usa ImageMagick WASM (`imagemagick_deno`) — leve, sem dependência
 * de binário no host, suporta JPEG/PNG/WebP/HEIC e aplica auto-orient nativamente.
 *
 * Importante: só processa imagens. Vídeos, áudios, PDFs e outros tipos passam direto.
 */

import { ImageMagick, initialize, MagickFormat } from "https://deno.land/x/imagemagick_deno@0.0.31/mod.ts";

let initialized = false;
async function ensureInit() {
  if (!initialized) {
    await initialize();
    initialized = true;
  }
}

/**
 * Faz fetch da URL e, se for imagem raster, retorna bytes corrigidos + content-type.
 * Caso seja qualquer outra coisa, devolve os bytes originais sem mexer.
 */
export async function fetchAndNormalizeImage(url: string): Promise<{
  bytes: Uint8Array;
  mimeType: string;
  modified: boolean;
}> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar mídia (${res.status})`);

  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  const bytes = new Uint8Array(await res.arrayBuffer());

  // Só normaliza JPEG/PNG/WebP/HEIC. Outros tipos passam direto.
  const isRasterImage =
    mimeType.startsWith("image/jpeg") ||
    mimeType.startsWith("image/jpg") ||
    mimeType.startsWith("image/png") ||
    mimeType.startsWith("image/webp") ||
    mimeType.startsWith("image/heic") ||
    mimeType.startsWith("image/heif");

  if (!isRasterImage) {
    return { bytes, mimeType, modified: false };
  }

  try {
    await ensureInit();
    const fixed = await new Promise<Uint8Array>((resolve, reject) => {
      ImageMagick.read(bytes, (img) => {
        try {
          img.autoOrient(); // aplica EXIF Orientation aos pixels e remove a flag
          img.write(MagickFormat.Jpeg, (data) => resolve(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    return { bytes: fixed, mimeType: "image/jpeg", modified: true };
  } catch (err) {
    console.warn("[image-utils] autoOrient falhou, usando bytes originais:", err);
    return { bytes, mimeType, modified: false };
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${uint8ToBase64(bytes)}`;
}
