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
 * Backfill: salva contatos antigos (chat_contacts) na agenda da instância uazapi.
 *
 * Dois modos:
 *  1) Manual (offset explícito): processa UM lote e devolve nextOffset/done.
 *  2) Cursor (cursor=true): lê/avança o offset persistido em
 *     uazapi_contact_backfill_state por instância — usado pelo cron até concluir.
 *
 * O endpoint /contact/add da uazapi é lento (~5s cada), então processamos em
 * ondas concorrentes (concurrency) para caber no tempo da edge function.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const whatsapp_number_id = body.whatsapp_number_id ?? null;
    const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 300);
    const concurrency = Math.min(Math.max(Number(body.concurrency) || 12, 1), 30);
    const useCursor = body.cursor === true;

    const { token } = await resolveUazapiCredentials(whatsapp_number_id);
    const supabase = getServiceClient();

    // Resolve o offset inicial (cursor persistido ou explícito).
    let offset = Math.max(Number(body.offset) || 0, 0);
    let prevSucceeded = 0;
    let prevFailed = 0;
    if (useCursor && whatsapp_number_id) {
      const { data: st } = await supabase
        .from("uazapi_contact_backfill_state")
        .select("offset, done, locked_at, total_succeeded, total_failed")
        .eq("whatsapp_number_id", whatsapp_number_id)
        .maybeSingle();
      if (st?.done) {
        return new Response(JSON.stringify({ success: true, alreadyDone: true, offset: st.offset }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Trava anti-sobreposição: se outra execução começou há menos de 5 min, sai.
      if (st?.locked_at && Date.now() - new Date(st.locked_at).getTime() < 5 * 60 * 1000) {
        return new Response(JSON.stringify({ success: true, skipped: "locked", offset: st.offset }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      offset = st?.offset ?? 0;
      prevSucceeded = st?.total_succeeded ?? 0;
      prevFailed = st?.total_failed ?? 0;
      // Marca a trava imediatamente.
      await supabase.from("uazapi_contact_backfill_state").upsert(
        { whatsapp_number_id, offset, locked_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: "whatsapp_number_id" },
      );
    }

    const { data: contacts, error } = await supabase
      .from("chat_contacts")
      .select("phone, display_name, custom_name")
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const rows = (contacts || []).filter((c) => c.phone);

    let succeeded = 0;
    let failed = 0;
    const errors: { phone: string; error: unknown }[] = [];

    // Processa em ondas concorrentes.
    for (let i = 0; i < rows.length; i += concurrency) {
      const wave = rows.slice(i, i + concurrency);
      await Promise.all(
        wave.map(async (c) => {
          const formattedPhone = formatUazapiNumber(String(c.phone));
          const name = (c.custom_name || c.display_name || formattedPhone).toString().trim();
          try {
            const r = await uazapiInstance("/contact/add", token, {
              method: "POST",
              body: { phone: formattedPhone, name },
            });
            if (r.ok) succeeded++;
            else {
              failed++;
              if (errors.length < 20) errors.push({ phone: formattedPhone, error: r.data });
            }
          } catch (e) {
            failed++;
            if (errors.length < 20) errors.push({ phone: formattedPhone, error: (e as Error).message });
          }
        }),
      );
    }

    const processed = (contacts || []).length;
    const done = processed < limit;
    const nextOffset = offset + processed;

    // Persiste o cursor para o cron continuar de onde parou e libera a trava.
    if (useCursor && whatsapp_number_id) {
      await supabase.from("uazapi_contact_backfill_state").upsert(
        {
          whatsapp_number_id,
          offset: nextOffset,
          done,
          last_succeeded: succeeded,
          last_failed: failed,
          total_succeeded: prevSucceeded + succeeded,
          total_failed: prevFailed + failed,
          locked_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "whatsapp_number_id" },
      );
    }

    return new Response(
      JSON.stringify({ success: true, processed, succeeded, failed, offset, nextOffset, done, errors }),
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
