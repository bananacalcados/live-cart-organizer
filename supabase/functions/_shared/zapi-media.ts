function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

/**
 * Z-API aceita imagem por URL ou base64. Para preservar a mídia original e evitar
 * previews estranhos/link cards quando a URL não aponta diretamente para um binário,
 * buscamos a imagem no backend e enviamos em base64.
 */
export async function prepareZApiImagePayload(mediaUrl: string): Promise<{
  image: string;
  mimeType: string;
}> {
  const response = await fetch(mediaUrl);

  if (!response.ok) {
    throw new Error(`Não foi possível baixar a imagem (${response.status})`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";

  if (!mimeType.startsWith("image/")) {
    throw new Error(`A URL informada não é uma imagem válida (content-type: ${mimeType || "desconhecido"})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const base64 = uint8ToBase64(bytes);

  return {
    image: `data:${mimeType};base64,${base64}`,
    mimeType,
  };
}
