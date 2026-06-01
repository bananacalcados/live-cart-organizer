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

    const payload: Record<string, unknown> = { number, type, file: mediaUrl };
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
