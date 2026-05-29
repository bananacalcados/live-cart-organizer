import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveWasenderCredentials, WASENDER_BASE, formatWasenderJid } from "../_shared/wasender-credentials.ts";
import { checkInstanceGuard } from "../_shared/instance-guard.ts";
import { webmToOgg, isWebmContainer, isOggContainer } from "../_shared/webm-to-ogg.ts";

/**
 * Garante que o áudio enviado ao WaSender seja um OGG/Opus válido.
 * Navegadores (Chrome) gravam audio/webm;codecs=opus, que o WhatsApp
 * reproduz "sem som". Fazemos o remux WebM→OGG e re-hospedamos o arquivo
 * num bucket público, devolvendo a nova URL. Em caso de falha, devolve a
 * URL original como fallback.
 */
async function ensureOggAudioUrl(mediaUrl: string): Promise<string> {
  try {
    if (mediaUrl.startsWith("data:")) return mediaUrl;
    const resp = await fetch(mediaUrl);
    if (!resp.ok) return mediaUrl;
    const original = new Uint8Array(await resp.arrayBuffer());
    if (original.byteLength === 0) return mediaUrl;

    let oggBytes: Uint8Array;
    if (isOggContainer(original)) {
      // Já é OGG — re-hospeda apenas para garantir content-type correto.
      oggBytes = original;
    } else if (isWebmContainer(original)) {
      oggBytes = webmToOgg(original);
    } else {
      // Formato desconhecido — tenta remux mesmo assim, senão usa original.
      try {
        oggBytes = webmToOgg(original);
      } catch {
        return mediaUrl;
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const path = `wasender/audio/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.ogg`;
    const { error } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, oggBytes, { contentType: "audio/ogg", upsert: false });
    if (error) {
      console.error("[wasender-send-media] upload OGG falhou:", error.message);
      return mediaUrl;
    }
    const { data } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
    console.log(`[wasender-send-media] Áudio remuxado para OGG (${oggBytes.length} bytes)`);
    return data?.publicUrl || mediaUrl;
  } catch (e) {
    console.error("[wasender-send-media] ensureOggAudioUrl erro:", (e as Error).message);
    return mediaUrl;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-force-instance",
};

// (normalização de JID centralizada em formatWasenderJid)

/** Mapeia o tipo de mídia para o campo de URL esperado pela WaSender. */
function mediaField(
  mediaType: string,
): "imageUrl" | "videoUrl" | "audioUrl" | "documentUrl" | "stickerUrl" {
  switch (mediaType) {
    case "image":
      return "imageUrl";
    case "video":
      return "videoUrl";
    case "audio":
      return "audioUrl";
    case "sticker":
      return "stickerUrl";
    default:
      return "documentUrl";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, mediaUrl, mediaType, caption, whatsapp_number_id } = await req.json();
    if (!phone || !mediaUrl) {
      return new Response(JSON.stringify({ error: "Phone and mediaUrl are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isGroupId =
      phone.includes("@") || phone.includes("-") || phone.replace(/\D/g, "").startsWith("120");
    if (!isGroupId) {
      const guard = await checkInstanceGuard({ req, phone, whatsappNumberId: whatsapp_number_id });
      if (!guard.ok) {
        return new Response(JSON.stringify(guard.body), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { apiKey } = await resolveWasenderCredentials(whatsapp_number_id);
    const to = formatWasenderJid(phone);

    // Áudio: remux WebM→OGG/Opus para o WhatsApp reproduzir corretamente.
    let finalMediaUrl = mediaUrl;
    if ((mediaType || "document") === "audio") {
      finalMediaUrl = await ensureOggAudioUrl(mediaUrl);
    }

    const payload: Record<string, unknown> = { to };
    if (caption) payload.text = caption;
    payload[mediaField(mediaType || "document")] = finalMediaUrl;

    const res = await fetch(`${WASENDER_BASE}/send-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      console.error("WaSender send media error:", data);
      return new Response(JSON.stringify({ error: "Failed to send media", details: data }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageId = data?.data?.msgId ? String(data.data.msgId) : null;
    return new Response(JSON.stringify({ success: true, messageId, data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending WaSender media:", error);
    return new Response(JSON.stringify({ error: "Internal server error", details: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
