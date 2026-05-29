import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveWasenderCredentials, WASENDER_BASE, formatWasenderJid } from "../_shared/wasender-credentials.ts";
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

    const { apiKey } = await resolveWasenderCredentials(whatsapp_number_id);
    const to = formatPhone(phone);

    const payload: Record<string, unknown> = { to, text: message };
    if (quotedMessageId) payload.quotedMessageId = quotedMessageId;

    const res = await fetch(`${WASENDER_BASE}/send-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      console.error("WaSender send error:", data);
      return new Response(JSON.stringify({ error: "Failed to send message", details: data }), {
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
    console.error("Error sending WaSender message:", error);
    return new Response(JSON.stringify({ error: "Internal server error", details: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
