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
 * uazapi-check-number — verifica se um número está registrado no WhatsApp.
 *
 * Body:
 *  - phone (ou phones: string[]), whatsapp_number_id
 *
 * Retorna: { success, exists, jid, data }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, phones, whatsapp_number_id } = await req.json();
    const list: string[] = Array.isArray(phones)
      ? phones
      : phone
        ? [phone]
        : [];
    if (list.length === 0) return json({ error: "phone é obrigatório" }, 400);

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);
    const normalized = list.map((p) => formatUazapiNumber(p));

    const r = await uazapiInstance("/chat/check", token, {
      method: "POST",
      body: { numbers: normalized, phone: normalized[0] },
    });
    if (!r.ok) return json({ error: "Falha ao verificar número", details: r.data }, r.status);

    const first = Array.isArray(r.data) ? r.data[0] : r.data;
    const exists = Boolean(first?.exists ?? first?.isInWhatsapp ?? first?.verifiedName);
    const jid = first?.jid || first?.id || null;
    return json({ success: true, exists, jid, data: r.data });
  } catch (e) {
    console.error("[uazapi-check-number] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
