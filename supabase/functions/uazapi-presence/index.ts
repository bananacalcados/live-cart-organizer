import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveUazapiCredentials, uazapiInstance, formatUazapiNumber } from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * uazapi-presence — envia presença ("digitando..."/"gravando áudio...").
 *
 * Body:
 *  - phone, whatsapp_number_id
 *  - presence: 'composing' | 'recording' | 'paused' | 'available' | 'unavailable'
 *  - delay?: number (ms que o estado permanece ativo)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, whatsapp_number_id, presence = "composing", delay } = await req.json();
    if (!phone) return json({ error: "phone é obrigatório" }, 400);

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);
    const number = formatUazapiNumber(phone);

    const payload: Record<string, unknown> = { number, presence };
    if (delay != null) payload.delay = Number(delay);

    const r = await uazapiInstance("/message/presence", token, { method: "POST", body: payload });
    if (!r.ok) return json({ error: "Falha na presença", details: r.data }, r.status);
    return json({ success: true, data: r.data });
  } catch (e) {
    console.error("[uazapi-presence] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
