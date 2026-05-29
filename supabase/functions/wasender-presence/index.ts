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

function formatJid(phone: string): string {
  if (phone.includes("@")) return phone;
  let digits = phone.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 11) digits = "55" + digits;
  return `${digits}@s.whatsapp.net`;
}

/**
 * wasender-presence — envia presença ("digitando..."/"gravando áudio...").
 *
 * Body:
 *  - phone, whatsapp_number_id
 *  - presence: 'composing' | 'recording' | 'paused' | 'available' | 'unavailable'
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, whatsapp_number_id, presence = "composing" } = await req.json();
    if (!phone) return json({ error: "phone é obrigatório" }, 400);

    const { apiKey } = await resolveWasenderCredentials(whatsapp_number_id);
    const res = await fetch(`${WASENDER_BASE}/send-presence-update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jid: formatJid(phone), presence }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return json({ error: "Falha na presença", details: data }, res.status);
    return json({ success: true, data });
  } catch (e) {
    console.error("[wasender-presence] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
