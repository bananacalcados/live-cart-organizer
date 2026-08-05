// Cache de media_id da Meta (Cloud API).
//
// PROBLEMA QUE ISSO RESOLVE: até aqui todo template com header de mídia era
// enviado com `image.link` (URL pública). A Meta baixa essa URL a CADA mensagem
// — em disparos grandes o storage/CDN devolve 500 e a Meta responde com o erro
// 131053 ("failed to download media"), derrubando centenas de envios.
//
// SOLUÇÃO: subir o arquivo UMA vez para a Meta (`POST /{phone_number_id}/media`),
// guardar o `media_id` em `meta_media_cache` e referenciar esse id nos headers
// (`image: { id }`). O media_id é válido por ~30 dias e é por número (phone_number_id).
//
// Se o upload falhar por qualquer motivo, o chamador deve continuar usando o link
// (fallback) — nunca deixar de enviar por causa do cache.

const GRAPH = "https://graph.facebook.com/v21.0";
/** Renovamos com folga antes dos 30 dias de validade da Meta. */
const TTL_MS = 25 * 24 * 60 * 60 * 1000;

const memCache = new Map<string, string>();

export type MetaMediaKind = "image" | "video" | "document" | "audio";

function guessMime(url: string, kind: MetaMediaKind): string {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".mp4")) return "video/mp4";
  if (clean.endsWith(".pdf")) return "application/pdf";
  if (clean.endsWith(".ogg")) return "audio/ogg";
  if (kind === "image") return "image/jpeg";
  if (kind === "video") return "video/mp4";
  if (kind === "audio") return "audio/ogg";
  return "application/pdf";
}

/**
 * Devolve um media_id da Meta para a URL informada, subindo o arquivo se
 * necessário. Retorna `null` quando não foi possível (o chamador deve cair
 * de volta para `link`).
 */
export async function resolveMetaMediaId(
  supabase: any,
  opts: {
    url: string;
    kind: MetaMediaKind;
    phoneNumberId: string;
    accessToken: string;
  },
): Promise<string | null> {
  const { url, kind, phoneNumberId, accessToken } = opts;
  if (!url || !phoneNumberId || !accessToken) return null;

  const key = `${phoneNumberId}::${url}`;
  const hit = memCache.get(key);
  if (hit) return hit;

  try {
    const { data: row } = await supabase
      .from("meta_media_cache")
      .select("media_id, expires_at")
      .eq("phone_number_id", phoneNumberId)
      .eq("media_url", url)
      .maybeSingle();
    if (row?.media_id && new Date(row.expires_at).getTime() > Date.now()) {
      memCache.set(key, row.media_id);
      return row.media_id;
    }
  } catch (_e) { /* cache é best-effort */ }

  try {
    const fileRes = await fetch(url);
    if (!fileRes.ok) {
      console.warn("[meta-media-cache] download falhou", url, fileRes.status);
      return null;
    }
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    const mime = fileRes.headers.get("content-type")?.split(";")[0] || guessMime(url, kind);

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    form.append("file", new Blob([bytes], { type: mime }), url.split("/").pop() || "media");

    const upRes = await fetch(`${GRAPH}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    const upData = await upRes.json().catch(() => ({}));
    const mediaId = upData?.id ? String(upData.id) : null;
    if (!upRes.ok || !mediaId) {
      console.warn("[meta-media-cache] upload falhou", JSON.stringify(upData).slice(0, 300));
      return null;
    }

    memCache.set(key, mediaId);
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    try {
      await supabase.from("meta_media_cache").upsert(
        {
          phone_number_id: phoneNumberId,
          media_url: url,
          media_id: mediaId,
          mime_type: mime,
          expires_at: expiresAt,
          uploaded_at: new Date().toISOString(),
        },
        { onConflict: "phone_number_id,media_url" },
      );
    } catch (_e) { /* best-effort */ }
    return mediaId;
  } catch (e) {
    console.warn("[meta-media-cache] erro:", (e as Error).message);
    return null;
  }
}

/**
 * Monta o parâmetro de header de mídia usando media_id quando disponível e
 * caindo para `link` quando o upload não foi possível.
 */
export async function buildMediaHeaderParam(
  supabase: any,
  opts: { url: string; kind: MetaMediaKind; phoneNumberId: string; accessToken: string },
): Promise<Record<string, unknown>> {
  const id = await resolveMetaMediaId(supabase, opts);
  return id
    ? { type: opts.kind, [opts.kind]: { id } }
    : { type: opts.kind, [opts.kind]: { link: opts.url } };
}
