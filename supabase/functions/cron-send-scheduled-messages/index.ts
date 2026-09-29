import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import { loadBlockedSuffixes, isBlocked } from "../_shared/blocked-guard.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(corsHeaders);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch pending messages that are due
    const { data: pending, error: fetchError } = await supabase
      .from("scheduled_messages")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(50);

    if (fetchError) throw fetchError;
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing ${pending.length} scheduled messages`);
    let sentCount = 0;

    // Bloqueio cross-instância: não envia mensagem agendada para contato bloqueado.
    const blockedSuffixes = await loadBlockedSuffixes(supabase);

    for (const msg of pending) {
      try {
        if (isBlocked(blockedSuffixes, msg.phone)) {
          await supabase.from("scheduled_messages")
            .update({ status: "blocked", error_message: "contato bloqueado" })
            .eq("id", msg.id).eq("status", "pending");
          continue;
        }
        // Lock: set status to 'sending' to prevent duplicates
        const { error: lockErr } = await supabase
          .from("scheduled_messages")
          .update({ status: "sending" })
          .eq("id", msg.id)
          .eq("status", "pending");

        if (lockErr) {
          console.warn(`Lock failed for ${msg.id}:`, lockErr);
          continue;
        }

        // Roteia pelo provider REAL da instância (meta | uazapi | wasender | zapi).
        // Antes, uazapi/wasender caíam no Z-API (vencido) e falhavam.
        let provider = "zapi";
        if (msg.whatsapp_number_id) {
          const { data: numData } = await supabase
            .from("whatsapp_numbers")
            .select("provider")
            .eq("id", msg.whatsapp_number_id)
            .maybeSingle();
          if (numData?.provider) provider = numData.provider;
        }
        const fn =
          provider === "meta" ? "meta-whatsapp-send"
          : provider === "uazapi" ? "uazapi-send-message"
          : provider === "wasender" ? "wasender-send-message"
          : "zapi-send-message";

        const res = await supabase.functions.invoke(fn, {
          body: { phone: msg.phone, message: msg.message, whatsapp_number_id: msg.whatsapp_number_id },
          headers: { "x-force-instance": "1" },
        });
        let errText: string | null = null;
        if (res.error) {
          try { errText = await (res.error as any).context?.text?.(); } catch { /* ignore */ }
          errText = errText || res.error.message;
        } else if (res.data && (res.data.error || res.data.success === false)) {
          errText = JSON.stringify(res.data.error || res.data).slice(0, 500);
        }
        const sendSuccess = !errText;
        const providerMessageId =
          res.data?.messageId ?? res.data?.data?.messages?.[0]?.id ?? res.data?.data?.messageid ?? null;
        if (errText) console.error(`[${provider}] send failed for ${msg.id}:`, errText);

        if (sendSuccess) {
          // Save to whatsapp_messages so it appears in chat history
          await supabase.from("whatsapp_messages").insert({
            phone: msg.phone,
            message: msg.message,
            direction: "outgoing",
            status: "sent",
            whatsapp_number_id: msg.whatsapp_number_id,
            ...(providerMessageId ? { message_id: String(providerMessageId) } : {}),
          });

          await supabase
            .from("scheduled_messages")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", msg.id);

          sentCount++;
        } else {
          await supabase
            .from("scheduled_messages")
            .update({ status: "failed", error_message: `[${provider}] ${errText}`.slice(0, 1000) })
            .eq("id", msg.id);
        }
      } catch (err) {
        console.error(`Error processing scheduled message ${msg.id}:`, err);
        await supabase
          .from("scheduled_messages")
          .update({ status: "failed", error_message: String(err) })
          .eq("id", msg.id);
      }
    }

    console.log(`Sent ${sentCount}/${pending.length} scheduled messages`);
    return new Response(JSON.stringify({ sent: sentCount, total: pending.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Cron scheduled messages error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
