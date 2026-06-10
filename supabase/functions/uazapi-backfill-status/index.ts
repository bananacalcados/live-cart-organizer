import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  resolveUazapiCredentials,
  uazapiInstance,
  getServiceClient,
  rehostMedia,
} from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v == null) return null;
  return String(v);
}

/** Mapeia mimetype/mediaType para o tipo do status. */
function typeFromMime(mime: string | null, mediaType: string | null): "image" | "video" | "text" {
  const m = (mime || "").toLowerCase();
  const t = (mediaType || "").toLowerCase();
  if (m.startsWith("video") || t === "video") return "video";
  if (m.startsWith("image") || t === "image" || t === "sticker") return "image";
  return "text";
}

/**
 * Backfill de status já publicados: para cada message_id, baixa a mídia na uazapi
 * (/message/download), re-hospeda no bucket e grava em whatsapp_status_posts.
 * Body: { whatsapp_number_id, message_ids: string[], fallbacks?: Record<id,{type,media_url}> }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { whatsapp_number_id, message_ids, fallbacks } = await req.json();
    if (!Array.isArray(message_ids) || message_ids.length === 0) {
      return new Response(JSON.stringify({ error: "message_ids é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);
    const supabase = getServiceClient();
    const results: Record<string, unknown>[] = [];

    for (const rawId of message_ids) {
      const id = String(rawId);
      let type: "image" | "video" | "text" = "text";
      let mediaUrl: string | null = null;
      let textContent: string | null = null;
      let caption: string | null = null;

      try {
        const dl = await uazapiInstance("/message/download", token, {
          method: "POST",
          body: { id, return_link: true },
        });
        const link = asString(dl.data?.url) || asString(dl.data?.fileURL);
        const mime = asString(dl.data?.mimetype) || asString(dl.data?.mimeType);
        const mediaType = asString(dl.data?.mediaType) || asString(dl.data?.type);
        caption = asString(dl.data?.caption) || asString(dl.data?.text) || null;

        if (link) {
          type = typeFromMime(mime, mediaType);
          mediaUrl = await rehostMedia(link, type === "video" ? "video" : "image", null);
        }
      } catch (e) {
        console.error(`[backfill-status] download falhou para ${id}:`, (e as Error).message);
      }

      // Fallback manual (ex.: arquivos já existentes no bucket) quando o download não retornou mídia.
      if (!mediaUrl && fallbacks && fallbacks[id]) {
        const fb = fallbacks[id];
        type = (fb.type as "image" | "video" | "text") || type;
        mediaUrl = (fb.media_url as string) || null;
        if (fb.caption) caption = fb.caption as string;
        if (fb.text_content) textContent = fb.text_content as string;
      }

      const { error } = await supabase.from("whatsapp_status_posts").upsert(
        {
          message_id: id,
          whatsapp_number_id: whatsapp_number_id || null,
          type,
          media_url: type === "text" ? null : mediaUrl,
          caption: type === "text" ? null : caption,
          text_content: type === "text" ? textContent : null,
        },
        { onConflict: "message_id" },
      );

      results.push({ message_id: id, type, media_url: mediaUrl, saved: !error, error: error?.message });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Erro no backfill de status:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
