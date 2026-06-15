import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveUazapiCredentials, uazapiInstance, formatUazapiNumber } from "../_shared/uazapi-credentials.ts";
import { checkInstanceGuard } from "../_shared/instance-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-force-instance",
};

// Mapeia o mediaType genérico do sistema para o `type` da uazapi.
function mapType(mediaType: string): string {
  switch ((mediaType || "").toLowerCase()) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "sticker":
      return "sticker";
    default:
      return "document";
  }
}

const BASE64_INLINE_MAX_BYTES = 24 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function buildUazapiFilePayload(mediaUrl: string, type: string): Promise<string> {
  // Para vídeo, não dependemos do servidor da uazapi baixar a URL pública.
  // O arquivo já foi validado/salvo no nosso storage; enviamos os bytes em base64
  // direto no campo `file`, formato aceito pela uazapi, evitando mídia "delivered"
  // mas sem dados reproduzíveis no app oficial do WhatsApp.
  if (type !== "video") return mediaUrl;

  const res = await fetch(mediaUrl, {
    headers: {
      Accept: "video/mp4,video/*;q=0.9,*/*;q=0.1",
      "User-Agent": "Banana-WhatsApp-Media-Relay/1.0",
    },
  });
  if (!res.ok) throw new Error(`Falha ao baixar vídeo para envio (${res.status})`);

  const contentType = (res.headers.get("content-type") || "video/mp4").split(";")[0].trim() || "video/mp4";
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("Vídeo vazio ao preparar envio");
  if (bytes.byteLength > BASE64_INLINE_MAX_BYTES) {
    throw new Error("Vídeo grande demais para envio direto pelo WhatsApp; envie um vídeo menor.");
  }
  return `data:${contentType};base64,${toBase64(bytes)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, mediaUrl, mediaType, caption, fileName, whatsapp_number_id, quotedMessageId } =
      await req.json();
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

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);
    const number = formatUazapiNumber(phone);
    const type = mapType(mediaType);
    const filePayload = await buildUazapiFilePayload(mediaUrl, type);

    const payload: Record<string, unknown> = { number, type, file: filePayload };
    if (type === "video") payload.path = filePayload;
    if (caption) payload.text = caption;
    if (type === "document" && fileName) payload.docName = fileName;
    if (quotedMessageId) payload.replyid = quotedMessageId;

    const r = await uazapiInstance("/send/media", token, { method: "POST", body: payload });
    if (!r.ok) {
      console.error("uazapi send-media error:", r.data);
      return new Response(JSON.stringify({ error: "Failed to send media", details: r.data }), {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageId =
      r.data?.messageid || r.data?.id || r.data?.message?.messageid || r.data?.message?.id || null;
    return new Response(JSON.stringify({ success: true, messageId, data: r.data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending uazapi media:", error);
    return new Response(JSON.stringify({ error: "Internal server error", details: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
