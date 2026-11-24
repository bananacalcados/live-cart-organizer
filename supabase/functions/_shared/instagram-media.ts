export interface InstagramMediaStorageClient {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

export function isTemporaryInstagramMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'lookaside.fbsbx.com'
      && url.pathname.startsWith('/ig_messaging_cdn/');
  } catch {
    return false;
  }
}

export function instagramMediaExtension(contentType: string, mediaType: string): string {
  const normalizedType = contentType.toLowerCase().split(';')[0].trim();
  const knownExtensions: Record<string, string> = {
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
  };
  if (knownExtensions[normalizedType]) return knownExtensions[normalizedType];

  const fallbacks: Record<string, string> = {
    audio: 'm4a',
    image: 'jpg',
    video: 'mp4',
    story: 'jpg',
    file: 'bin',
  };
  return fallbacks[mediaType] || 'bin';
}

/**
 * Os anexos do Direct chegam com URL assinada e temporária. Copiamos apenas
 * esse domínio conhecido para o bucket público; em qualquer falha preservamos
 * a URL original para não derrubar o recebimento da mensagem.
 */
export async function rehostInstagramMedia(
  supabase: InstagramMediaStorageClient,
  tempUrl: string,
  mediaType: string,
  fetcher: typeof fetch = fetch,
): Promise<{ url: string; isVideo: boolean }> {
  const fallback = { url: tempUrl, isVideo: mediaType === 'video' };
  if (!isTemporaryInstagramMediaUrl(tempUrl)) return fallback;

  try {
    const res = await fetcher(tempUrl);
    if (!res.ok) {
      console.warn('[instagram-media] download falhou:', res.status);
      return fallback;
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) return fallback;

    const isVideo = mediaType === 'video' || contentType.toLowerCase().startsWith('video/');
    const ext = instagramMediaExtension(contentType, mediaType);
    const folder = /^[a-z]+$/.test(mediaType) ? mediaType : 'file';
    const path = `instagram/${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from('whatsapp-media')
      .upload(path, buf, { contentType, upsert: false });
    if (error) {
      console.error('[instagram-media] upload falhou:', error.message);
      return { url: tempUrl, isVideo };
    }

    const { data } = supabase.storage.from('whatsapp-media').getPublicUrl(path);
    return { url: data?.publicUrl || tempUrl, isVideo };
  } catch (error) {
    console.error('[instagram-media] erro:', error instanceof Error ? error.message : 'desconhecido');
    return fallback;
  }
}
