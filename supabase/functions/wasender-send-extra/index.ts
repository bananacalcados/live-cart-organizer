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

/**
 * wasender-send-extra — envia contato, localização ou enquete via WaSender.
 *
 * Body:
 *  - kind: 'contact' | 'location' | 'poll'
 *  - phone, whatsapp_number_id
 *  - contact: { name, phone }
 *  - location: { latitude, longitude, name?, address? }
 *  - poll: { name, options: string[], selectableCount?: number }
 *  - text?: legenda opcional
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { kind, phone, whatsapp_number_id, contact, location, poll, text } = await req.json();
    if (!phone || !kind) {
      return new Response(JSON.stringify({ error: "phone e kind são obrigatórios" }), {
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
    if (text) payload.text = text;

    if (kind === "contact") {
      if (!contact?.phone || !contact?.name) {
        return new Response(JSON.stringify({ error: "contact.name e contact.phone são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      payload.contact = { name: contact.name, phone: contact.phone };
    } else if (kind === "location") {
      if (location?.latitude == null || location?.longitude == null) {
        return new Response(JSON.stringify({ error: "location.latitude e location.longitude são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      payload.location = {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        ...(location.name ? { name: location.name } : {}),
        ...(location.address ? { address: location.address } : {}),
      };
    } else if (kind === "poll") {
      if (!poll?.name || !Array.isArray(poll?.options) || poll.options.length < 2) {
        return new Response(JSON.stringify({ error: "poll.name e ao menos 2 poll.options são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      payload.poll = {
        name: poll.name,
        options: poll.options,
        selectableCount: poll.selectableCount ?? 1,
      };
    } else {
      return new Response(JSON.stringify({ error: `kind inválido: ${kind}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(`${WASENDER_BASE}/send-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      console.error("WaSender send-extra error:", data);
      return new Response(JSON.stringify({ error: "Failed to send", details: data }), {
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
    console.error("Error in wasender-send-extra:", error);
    return new Response(JSON.stringify({ error: "Internal server error", details: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
