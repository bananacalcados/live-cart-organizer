import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveWasenderCredentials, WASENDER_BASE } from "../_shared/wasender-credentials.ts";

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
 * wasender-check-number — verifica se um número está no WhatsApp.
 * Body: { phone, whatsapp_number_id }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, whatsapp_number_id } = await req.json();
    if (!phone) return json({ error: "phone é obrigatório" }, 400);

    let digits = phone.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 11) digits = "55" + digits;

    const { apiKey } = await resolveWasenderCredentials(whatsapp_number_id);
    const res = await fetch(`${WASENDER_BASE}/on-whatsapp/${digits}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return json({ error: "Falha ao checar número", details: data }, res.status);

    const exists = Boolean(data?.exists ?? data?.data?.exists ?? data?.data?.[0]?.exists);
    return json({ success: true, exists, data });
  } catch (e) {
    console.error("[wasender-check-number] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
