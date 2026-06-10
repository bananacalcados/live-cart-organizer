import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  resolveUazapiCredentials,
  uazapiInstance,
  formatUazapiNumber,
  getServiceClient,
} from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Backfill: salva TODOS os contatos antigos (chat_contacts) na agenda da
 * instância uazapi, em lotes. Processa um lote por chamada e devolve um cursor
 * (nextOffset) para ser chamado novamente até `done = true`.
 *
 * Body:
 *  - whatsapp_number_id (opcional): instância de destino. Default = única ativa.
 *  - limit (default 250): tamanho do lote.
 *  - offset (default 0): a partir de onde processar.
 *  - delayMs (default 250): pausa entre cada contato (anti-ban).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const whatsapp_number_id = body.whatsapp_number_id ?? null;
    const limit = Math.min(Math.max(Number(body.limit) || 250, 1), 500);
    const offset = Math.max(Number(body.offset) || 0, 0);
    const delayMs = Math.min(Math.max(Number(body.delayMs) ?? 250, 0), 5000);

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);
    const supabase = getServiceClient();

    const { data: contacts, error } = await supabase
      .from("chat_contacts")
      .select("phone, display_name, custom_name")
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    let success = 0;
    let failed = 0;
    const errors: { phone: string; error: unknown }[] = [];

    for (const c of contacts || []) {
      if (!c.phone) continue;
      const formattedPhone = formatUazapiNumber(String(c.phone));
      const name = (c.custom_name || c.display_name || formattedPhone).toString().trim();
      try {
        const r = await uazapiInstance("/contact/add", token, {
          method: "POST",
          body: { phone: formattedPhone, name },
        });
        if (r.ok) success++;
        else {
          failed++;
          if (errors.length < 20) errors.push({ phone: formattedPhone, error: r.data });
        }
      } catch (e) {
        failed++;
        if (errors.length < 20) errors.push({ phone: formattedPhone, error: (e as Error).message });
      }
      if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    }

    const processed = (contacts || []).length;
    const done = processed < limit;
    const nextOffset = offset + processed;

    return new Response(
      JSON.stringify({ success: true, processed, succeeded: success, failed, nextOffset, done, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Erro no backfill de contatos uazapi:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
