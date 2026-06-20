import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveUazapiCredentials, uazapiInstance, formatUazapiNumber } from "../_shared/uazapi-credentials.ts";
import { checkInstanceGuard } from "../_shared/instance-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-force-instance",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * uazapi-send-extra — envia contato, localização ou enquete via uazapi.
 *
 * Body:
 *  - kind: 'contact' | 'location' | 'poll'
 *  - phone, whatsapp_number_id
 *  - contact: { name, phone }
 *  - location: { latitude, longitude, name?, address? }
 *  - poll: { name|question, options: string[], selectableCount?: number }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { kind, phone, whatsapp_number_id, contact, location, poll } = await req.json();
    if (!phone || !kind) return json({ error: "phone e kind são obrigatórios" }, 400);

    const isGroupId =
      phone.includes("@") || phone.includes("-") || phone.replace(/\D/g, "").startsWith("120");
    if (!isGroupId) {
      const guard = await checkInstanceGuard({ req, phone, whatsappNumberId: whatsapp_number_id });
      if (!guard.ok) return json(guard.body, 409);
    }

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);
    const number = formatUazapiNumber(phone);

    let path: string;
    let payload: Record<string, unknown>;

    if (kind === "contact") {
      if (!contact?.phone || !contact?.name) {
        return json({ error: "contact.name e contact.phone são obrigatórios" }, 400);
      }
      path = "/send/contact";
      payload = { number, contact: { fullName: contact.name, phoneNumber: contact.phone } };
    } else if (kind === "location") {
      if (location?.latitude == null || location?.longitude == null) {
        return json({ error: "location.latitude e location.longitude são obrigatórios" }, 400);
      }
      path = "/send/location";
      payload = {
        number,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        ...(location.name ? { name: location.name } : {}),
        ...(location.address ? { address: location.address } : {}),
      };
    } else if (kind === "poll") {
      const question = poll?.question || poll?.name;
      if (!question || !Array.isArray(poll?.options) || poll.options.length < 2) {
        return json({ error: "poll.question e ao menos 2 poll.options são obrigatórios" }, 400);
      }
      // uazapi envia enquete pelo endpoint unificado /send/menu (type: "poll").
      // NÃO existe /send/poll (retorna 405 Method Not Allowed).
      path = "/send/menu";
      payload = {
        number,
        type: "poll",
        text: question,
        choices: poll.options,
        selectableCount: poll.selectableCount ?? 1,
      };
    } else {
      return json({ error: `kind inválido: ${kind}` }, 400);
    }

    const r = await uazapiInstance(path, token, { method: "POST", body: payload });
    if (!r.ok) {
      console.error("uazapi send-extra error:", r.data);
      return json({ error: "Failed to send", details: r.data }, r.status);
    }

    const messageId =
      r.data?.messageid || r.data?.id || r.data?.message?.messageid || r.data?.message?.id || null;
    return json({ success: true, messageId, data: r.data });
  } catch (e) {
    console.error("Error in uazapi-send-extra:", e);
    return json({ error: "Internal server error", details: (e as Error).message }, 500);
  }
});
