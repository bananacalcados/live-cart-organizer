import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  instagramMediaExtension,
  isTemporaryInstagramMediaUrl,
  rehostInstagramMedia,
  type InstagramMediaStorageClient,
} from './instagram-media.ts';

Deno.test('só reconhece a URL temporária oficial de anexos do Direct', () => {
  assert(isTemporaryInstagramMediaUrl('https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=123&signature=abc'));
  assert(!isTemporaryInstagramMediaUrl('https://lookaside.fbsbx.com/outro-caminho/?asset_id=123'));
  assert(!isTemporaryInstagramMediaUrl('https://exemplo.com/ig_messaging_cdn/?asset_id=123'));
  assert(!isTemporaryInstagramMediaUrl('url inválida'));
});

Deno.test('usa extensões que o player consegue identificar', () => {
  assertEquals(instagramMediaExtension('audio/mp4; codecs=mp4a.40.2', 'audio'), 'm4a');
  assertEquals(instagramMediaExtension('audio/mpeg', 'audio'), 'mp3');
  assertEquals(instagramMediaExtension('application/octet-stream', 'audio'), 'm4a');
  assertEquals(instagramMediaExtension('video/mp4', 'video'), 'mp4');
});

function storageDouble(uploadError: { message: string } | null = null) {
  const uploads: Array<{ bucket: string; path: string; body: Uint8Array; contentType: string }> = [];
  const client: InstagramMediaStorageClient = {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }) {
            uploads.push({ bucket, path, body, contentType: options.contentType });
            return { error: uploadError };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://storage.local/whatsapp-media/${path}` } };
          },
        };
      },
    },
  };
  return { client, uploads };
}

Deno.test('copia o áudio temporário para uma URL permanente antes de salvar a mensagem', async () => {
  const { client, uploads } = storageDouble();
  const original = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=123&signature=abc';
  const result = await rehostInstagramMedia(
    client,
    original,
    'audio',
    async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mp4' } }),
  );

  assertEquals(uploads.length, 1);
  assertEquals(uploads[0].bucket, 'whatsapp-media');
  assertEquals(uploads[0].contentType, 'audio/mp4');
  assert(uploads[0].path.endsWith('.m4a'));
  assertEquals(result.url, `https://storage.local/whatsapp-media/${uploads[0].path}`);
});

Deno.test('se a cópia falhar preserva a mensagem e a URL original', async () => {
  const { client, uploads } = storageDouble({ message: 'falha simulada' });
  const original = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=123&signature=abc';
  const result = await rehostInstagramMedia(
    client,
    original,
    'audio',
    async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'audio/mp4' } }),
  );

  assertEquals(uploads.length, 1);
  assertEquals(result.url, original);
});

Deno.test('um anexo já vencido não interrompe o recebimento da mensagem', async () => {
  const { client, uploads } = storageDouble();
  const original = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=123&signature=abc';
  const result = await rehostInstagramMedia(client, original, 'audio', async () => new Response('apagado', { status: 404 }));
  assertEquals(result.url, original);
  assertEquals(uploads.length, 0);
});
