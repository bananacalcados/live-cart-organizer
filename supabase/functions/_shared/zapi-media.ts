import { fetchAndNormalizeImage, bytesToDataUrl } from "./image-utils.ts";

/**
 * Z-API aceita imagem por URL ou base64. Para preservar a mídia original e evitar
 * previews estranhos/link cards quando a URL não aponta diretamente para um binário,
 * buscamos a imagem no backend e enviamos em base64.
 *
 * Além disso, normalizamos a orientação EXIF (autoOrient) — sem isso, fotos tiradas
 * em modo retrato chegam deitadas no WhatsApp porque o Business API descarta a flag
 * EXIF Orientation ao reempacotar a mídia para grupos.
 */
export async function prepareZApiImagePayload(mediaUrl: string): Promise<{
  image: string;
  mimeType: string;
}> {
  const { bytes, mimeType, modified } = await fetchAndNormalizeImage(mediaUrl);

  if (!mimeType.startsWith("image/")) {
    throw new Error(`A URL informada não é uma imagem válida (content-type: ${mimeType || "desconhecido"})`);
  }

  if (modified) {
    console.log("[zapi-media] EXIF orientation normalizado");
  }

  return {
    image: bytesToDataUrl(bytes, mimeType),
    mimeType,
  };
}
