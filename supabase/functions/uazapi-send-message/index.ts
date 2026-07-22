import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveUazapiCredentials, uazapiInstance, formatUazapiNumber } from "../_shared/uazapi-credentials.ts";
import { checkInstanceGuard } from "../_shared/instance-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-force-instance",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, message, whatsapp_number_id, quotedMessageId } = await req.json();
    if (!phone || !message) {
      return new Response(JSON.stringify({ error: "Phone and message are required" }), {
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

    const payload: Record<string, unknown> = { number, text: message };
    if (quotedMessageId) payload.replyid = quotedMessageId;

    const r = await uazapiInstance("/send/text", token, { method: "POST", body: payload });
    if (!r.ok) {
      console.error("uazapi send error:", r.data);
      const detailMsg = String(r.data?.error || r.data?.message || "").toLowerCase();
      const notOnWhatsapp =
        detailMsg.includes("not on whatsapp") ||
        detailMsg.includes("is not on whatsapp") ||
        detailMsg.includes("não está no whatsapp");
      if (notOnWhatsapp) {
        return new Response(
          JSON.stringify({
            error: "number_not_on_whatsapp",
            message: "Este número não possui WhatsApp.",
            details: r.data,
          }),
          {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ error: "Failed to send message", details: r.data }), {
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
    console.error("Error sending uazapi message:", error);
    return new Response(JSON.stringify({ error: "Internal server error", details: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
