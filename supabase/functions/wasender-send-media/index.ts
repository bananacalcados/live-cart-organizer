import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveWasenderCredentials, WASENDER_BASE } from "../_shared/wasender-credentials.ts";
import { checkInstanceGuard } from "../_shared/instance-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-force-instance",
};

function formatPhone(phone: string): string {
  if (phone.includes("@") || phone.includes("-")) return phone;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("120")) return digits;
  if (digits.length >= 10 && digits.length <= 11) digits = "55" + digits;
  return digits;
}

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
    const to = formatPhone(phone);

    const payload: Record<string, unknown> = { to };
    if (caption) payload.text = caption;
    payload[mediaField(mediaType || "document")] = mediaUrl;

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
