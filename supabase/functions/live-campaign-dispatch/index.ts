// Cron: processa fila de despachos pendentes da Live, envia via Z-API na ordem
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH = 25;
const LOCK_SECONDS = 90;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const now = new Date();
    const lockUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

    // Pega despachos pendentes prontos pra enviar (ou expirados de lock)
    const { data: ready, error: selErr } = await supabase
      .from("live_campaign_dispatches")
      .select("id, campaign_id, message_id, phone, lead_id, attempts, whatsapp_number_id, channel, ig_user_id, ig_comment_id")
      .eq("status", "pending")
      .lte("scheduled_at", now.toISOString())
      .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
      .order("scheduled_at", { ascending: true })
      .limit(BATCH);

    if (selErr) throw selErr;
    if (!ready || ready.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;

    for (const d of ready) {
      // Trava
      const { data: claimed } = await supabase
        .from("live_campaign_dispatches")
        .update({ locked_until: lockUntil, attempts: (d.attempts || 0) + 1 })
        .eq("id", d.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      try {
        // Carrega a mensagem e a campanha (pra obter número de fallback)
        const [{ data: msg }, { data: camp }] = await Promise.all([
          supabase
            .from("live_campaign_messages")
            .select("message_type, content, media_url, caption")
            .eq("id", d.message_id)
            .single(),
          supabase
            .from("live_campaigns")
            .select("whatsapp_number_id")
            .eq("id", d.campaign_id)
            .single(),
        ]);

        if (!msg) throw new Error("message_not_found");

        // Prioridade: número do despacho (origem da trigger) → da campanha
        const whatsappNumberId = d.whatsapp_number_id ?? camp?.whatsapp_number_id ?? undefined;

        let result: { success: boolean; error?: string; status?: number } = { success: false };

        if (msg.message_type === "text") {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/zapi-send-message`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              phone: d.phone,
              message: msg.content || "",
              whatsapp_number_id: whatsappNumberId,
            }),
          });
          const j = await r.json().catch(() => ({}));
          const errDetail = typeof j?.error === "string" ? j.error : JSON.stringify(j?.error || j?.details || j || {}).slice(0, 400);
          result = { success: r.ok && j?.success !== false && !j?.error, error: r.ok && !j?.error ? undefined : `[${r.status}] ${errDetail}`, status: r.status };
        } else {
          // mídia (audio | video | image | document)
          const r = await fetch(`${SUPABASE_URL}/functions/v1/zapi-send-media`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              phone: d.phone,
              mediaUrl: msg.media_url,
              mediaType: msg.message_type,
              caption: msg.caption || "",
              whatsapp_number_id: whatsappNumberId,
            }),
          });
          const j = await r.json().catch(() => ({}));
          const errDetail = typeof j?.error === "string" ? j.error : JSON.stringify(j?.error || j?.details || j || {}).slice(0, 400);
          result = { success: r.ok && j?.success !== false && !j?.error, error: r.ok && !j?.error ? undefined : `[${r.status}] ${errDetail}`, status: r.status };
          if (!result.success) {
            console.error(`[live-dispatch] media send failed phone=${d.phone} type=${msg.message_type} status=${r.status} body=${errDetail}`);
          }
        }

        if (result.success) {
          await supabase
            .from("live_campaign_dispatches")
            .update({ status: "sent", sent_at: new Date().toISOString(), locked_until: null })
            .eq("id", d.id);
          sent++;

          // Se este foi o ÚLTIMO despacho pendente desta campanha para este telefone,
          // ativa o "Modo Jess" criando uma sessão de IA vinculada à live_campaign.
          try {
            const { count: stillPending } = await supabase
              .from("live_campaign_dispatches")
              .select("id", { count: "exact", head: true })
              .eq("campaign_id", d.campaign_id)
              .eq("phone", d.phone)
              .eq("status", "pending");

            if ((stillPending ?? 0) === 0) {
              const { data: lc } = await supabase
                .from("live_campaigns")
                .select("jess_enabled, slug, name")
                .eq("id", d.campaign_id)
                .maybeSingle();

              // Dispara CompleteRegistration ao finalizar a sequência
              try {
                EdgeRuntime.waitUntil(
                  supabase.functions.invoke("meta-capi-lead", {
                    body: {
                      phone: d.phone,
                      event_name: "CompleteRegistration",
                      campaign_id: d.campaign_id,
                      campaign_slug: lc?.slug ?? null,
                      campaign_name: lc?.name ?? null,
                    },
                  }).then((r) => {
                    console.log(`[live-dispatch] meta-capi CompleteRegistration sent for ${d.phone}`, r?.data?.event_id);
                  }).catch((e) => {
                    console.error("[live-dispatch] meta-capi CR error (non-critical):", e?.message || e);
                  })
                );
              } catch (capiErr) {
                console.error("[live-dispatch] capi invoke wrap error:", capiErr);
              }

              if (lc?.jess_enabled) {
                const phoneDigits = d.phone.replace(/\D/g, "");
                // Não duplicar sessão ativa
                const { data: existingSession } = await supabase
                  .from("automation_ai_sessions")
                  .select("id")
                  .eq("phone", phoneDigits)
                  .eq("is_active", true)
                  .maybeSingle();

                if (!existingSession) {
                  await supabase.from("automation_ai_sessions").insert({
                    phone: phoneDigits,
                    live_campaign_id: d.campaign_id,
                    is_active: true,
                  });
                  console.log(`[live-dispatch] Modo Jess ativado para ${d.phone} (campaign=${d.campaign_id})`);
                }
              }
            }
          } catch (jessErr) {
            console.error("[live-dispatch] erro ativando Jess/CAPI:", jessErr);
          }
        } else {
          // Falha: marca como failed se já tentou 3x, senão volta a pending
          const willGiveUp = (d.attempts || 0) + 1 >= 3;
          await supabase
            .from("live_campaign_dispatches")
            .update({
              status: willGiveUp ? "failed" : "pending",
              error_message: result.error || "send_failed",
              locked_until: null,
            })
            .eq("id", d.id);
          failed++;
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const willGiveUp = (d.attempts || 0) + 1 >= 3;
        await supabase
          .from("live_campaign_dispatches")
          .update({
            status: willGiveUp ? "failed" : "pending",
            error_message: errMsg,
            locked_until: null,
          })
          .eq("id", d.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({ processed: ready.length, sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[live-dispatch] erro:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
