// Detecta frase-chave em mensagem incoming e dispara cadastro + sequência
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalize(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json();
    const { phone, message, sender_name, whatsapp_number_id, ig_user_id, ig_comment_id, ig_username } = body;

    if (!phone || !message) {
      return new Response(JSON.stringify({ matched: false, reason: "missing_fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedMsg = normalize(message);

    // Busca campanhas ativas
    const { data: campaigns, error: campErr } = await supabase
      .from("live_campaigns")
      .select("id, name, slug, trigger_phrase, ask_shoe_size, jess_enabled, whatsapp_number_id, channel_preference")
      .eq("is_active", true);

    if (campErr) throw campErr;
    if (!campaigns || campaigns.length === 0) {
      return new Response(JSON.stringify({ matched: false, reason: "no_active_campaigns" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Match: a frase-chave normalizada precisa estar contida na mensagem normalizada
    const matched = campaigns.find((c) => normalizedMsg.includes(normalize(c.trigger_phrase)));

    if (!matched) {
      return new Response(JSON.stringify({ matched: false, reason: "no_phrase_match" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[live-trigger] Frase "${matched.trigger_phrase}" detectada para ${phone} (campanha ${matched.name})`);

    // Anti-duplicação: ignora apenas se já houver despacho pendente/enviado.
    // Falhas antigas não devem bloquear um novo teste.
    const { count: dispatchCount } = await supabase
      .from("live_campaign_dispatches")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", matched.id)
      .eq("phone", phone)
      .in("status", ["pending", "sent"]);

    if ((dispatchCount ?? 0) > 0) {
      console.log(`[live-trigger] Lead ${phone} já tem despachos para esta campanha, ignorando`);
      return new Response(
        JSON.stringify({ matched: true, campaign: matched.slug, skipped: "already_dispatched" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cria/atualiza ad_lead
    const phoneSuffix = phone.replace(/\D/g, "").slice(-8);
    const { data: existingLead } = await supabase
      .from("ad_leads")
      .select("id")
      .filter("phone", "ilike", `%${phoneSuffix}`)
      .limit(1)
      .maybeSingle();

    let leadId = existingLead?.id;
    const tagToAdd = `live:${matched.slug}`;

    if (leadId) {
      // Atualiza adicionando a tag e a referência da campanha
      const { data: lead } = await supabase
        .from("ad_leads")
        .select("tags")
        .eq("id", leadId)
        .single();
      const existingTags: string[] = Array.isArray(lead?.tags) ? lead!.tags : [];
      const newTags = existingTags.includes(tagToAdd) ? existingTags : [...existingTags, tagToAdd];

      await supabase
        .from("ad_leads")
        .update({
          live_campaign_id: matched.id,
          tags: newTags,
          name: sender_name ?? undefined,
          channel: "zapi",
          source: "live",
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
    } else {
      const { data: newLead, error: insErr } = await supabase
        .from("ad_leads")
        .insert({
          phone,
          name: sender_name || null,
          live_campaign_id: matched.id,
          tags: [tagToAdd],
          channel: "zapi",
          source: "live",
          temperature: "morno",
          collected_data: {
            campaign_slug: matched.slug,
            campaign_name: matched.name,
            trigger_phrase: matched.trigger_phrase,
            captured_at: new Date().toISOString(),
          },
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      leadId = newLead.id;
    }

    // Espelha em lp_leads para aparecer na aba "Leads" do módulo Marketing
    try {
      const { data: existingLp } = await supabase
        .from("lp_leads")
        .select("id")
        .eq("campaign_tag", tagToAdd)
        .filter("phone", "ilike", `%${phoneSuffix}`)
        .limit(1)
        .maybeSingle();

      if (!existingLp) {
        const lpWhatsappNumberId = matched.whatsapp_number_id ?? whatsapp_number_id ?? null;
        const { error: lpInsertError } = await supabase.from("lp_leads").insert({
          phone,
          name: sender_name || null,
          campaign_tag: tagToAdd,
          source: "live_campaign",
          metadata: {
            campaign_slug: matched.slug,
            campaign_name: matched.name,
            trigger_phrase: matched.trigger_phrase,
            whatsapp_number_id: lpWhatsappNumberId,
            captured_at: new Date().toISOString(),
          },
        });

        if (lpInsertError) throw lpInsertError;
        console.log(`[live-trigger] lp_leads criado para ${phone} (tag=${tagToAdd})`);
      } else {
        console.log(`[live-trigger] lp_leads já existia para ${phone} (tag=${tagToAdd})`);
      }
    } catch (lpErr) {
      console.error("[live-trigger] Falha ao espelhar em lp_leads:", lpErr);
    }

    // Atualiza contador da campanha
    try {
      await supabase.rpc("increment_execution_count", { message_id: matched.id });
    } catch (rpcErr) {
      console.error("[live-trigger] increment_execution_count error (não-crítico):", rpcErr);
    }
    await supabase
      .from("live_campaigns")
      .update({ total_leads: (dispatchCount ?? 0) + 1 })
      .eq("id", matched.id);

    // Dispara evento Meta CAPI 'Lead' (fire-and-forget, não bloqueia)
    try {
      EdgeRuntime.waitUntil(
        supabase.functions.invoke("meta-capi-lead", {
          body: {
            phone,
            event_name: "Lead",
            campaign_id: matched.id,
            campaign_slug: matched.slug,
            campaign_name: matched.name,
            full_name: sender_name || null,
          },
        }).then((r) => {
          console.log(`[live-trigger] meta-capi Lead dispatched for ${phone}`, r?.data?.event_id);
        }).catch((e) => {
          console.error("[live-trigger] meta-capi Lead error (non-critical):", e?.message || e);
        })
      );
    } catch (capiErr) {
      console.error("[live-trigger] capi invoke wrap error:", capiErr);
    }

    // Busca mensagens completas da sequência (ativas, ordenadas)
    const { data: messages } = await supabase
      .from("live_campaign_messages")
      .select("id, sort_order, delay_seconds, message_type, content, media_url, caption")
      .eq("campaign_id", matched.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ matched: true, lead_id: leadId, dispatched: 0, reason: "no_messages" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cria registros de dispatch já como "sent" (auditoria) — envio direto, sem cron
    const nowIso = new Date().toISOString();
    // Resolve o número que será usado para o envio JÁ AQUI, para persistir no dispatch
    // Prioridade: whatsapp_number_id da campanha → instância que recebeu o webhook (origem)
    const resolvedNumberId = matched.whatsapp_number_id ?? whatsapp_number_id ?? null;

    // === Resolução de canal ===
    // channel_preference: 'whatsapp' (default) | 'instagram' | 'meta_whatsapp' | 'auto'
    const pref = (matched as any).channel_preference || "whatsapp";
    let resolvedChannel: "whatsapp" | "instagram" = "whatsapp";
    let resolvedIgUserId: string | null = ig_user_id || null;
    let resolvedIgCommentId: string | null = ig_comment_id || null;

    if (pref === "instagram" || (pref === "auto" && (ig_user_id || ig_username))) {
      resolvedChannel = "instagram";
      // Se veio só username, tenta resolver ig_user_id na tabela de vínculos
      if (!resolvedIgUserId && ig_username) {
        const cleanU = String(ig_username).replace(/^@/, "").trim().toLowerCase();
        const { data: link } = await supabase
          .from("instagram_user_links")
          .select("ig_user_id")
          .ilike("username", cleanU)
          .maybeSingle();
        resolvedIgUserId = link?.ig_user_id || null;
      }
    }

    const dispatchRows = messages.map((m) => ({
      campaign_id: matched.id,
      message_id: m.id,
      lead_id: leadId,
      phone,
      scheduled_at: nowIso,
      status: "pending" as const,
      whatsapp_number_id: resolvedNumberId,
      channel: resolvedChannel,
      ig_user_id: resolvedIgUserId,
      ig_comment_id: resolvedIgCommentId,
    }));
    const { data: insertedDispatches } = await supabase
      .from("live_campaign_dispatches")
      .insert(dispatchRows)
      .select("id, message_id");

    const dispatchIdByMessage = new Map<string, string>();
    (insertedDispatches || []).forEach((d) => dispatchIdByMessage.set(d.message_id, d.id));

    // Função de envio sequencial em background (não bloqueia a resposta do webhook)
    const sendSequence = async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // Fallback: se a campanha não tiver número configurado, usa o número que recebeu a mensagem
      const whatsappNumberId = matched.whatsapp_number_id ?? whatsapp_number_id ?? undefined;
      let provider: "zapi" | "meta" = "zapi";

      if (whatsappNumberId) {
        const { data: numberData, error: numberErr } = await supabase
          .from("whatsapp_numbers")
          .select("provider")
          .eq("id", whatsappNumberId)
          .maybeSingle();

        if (numberErr) {
          console.error("[live-trigger] erro resolvendo provider do número:", numberErr);
        } else if (numberData?.provider === "meta") {
          provider = "meta";
        }
      }

      console.log(
        `[live-trigger] Usando whatsapp_number_id=${whatsappNumberId} provider=${provider} (campanha=${matched.whatsapp_number_id}, webhook=${whatsapp_number_id})`
      );

      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const dispatchId = dispatchIdByMessage.get(m.id);

        // Delay antes de cada mensagem (exceto a primeira sai imediata)
        if (i > 0) {
          const delaySec = m.delay_seconds || 2;
          await sleep(delaySec * 1000);
        }

        // Retry com backoff: tenta até 3x antes de marcar como failed
        const MAX_ATTEMPTS = 3;
        let attempt = 0;
        let result: { success: boolean; error?: string; messageId?: string | null; status?: number } = { success: false };

        while (attempt < MAX_ATTEMPTS) {
          attempt++;
          try {
            if (m.message_type === "text") {
              const endpoint = provider === "meta" ? "meta-whatsapp-send" : "zapi-send-message";
              const r = await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${SERVICE_KEY}`,
                },
                body: JSON.stringify({
                  phone,
                  message: m.content || "",
                  whatsapp_number_id: whatsappNumberId,
                }),
              });
              const j = await r.json().catch(() => ({}));
              const errDetail = typeof j?.error === "string"
                ? j.error
                : JSON.stringify(j?.error || j?.details || j || {}).slice(0, 300);
              result = {
                success: r.ok && j?.success !== false && !j?.error,
                error: r.ok && !j?.error ? undefined : `[${r.status}] ${errDetail}`,
                messageId: j?.messageId || j?.data?.messageId || j?.data?.id || null,
                status: r.status,
              };
            } else {
              const endpoint = provider === "meta" ? "meta-whatsapp-send" : "zapi-send-media";
              const r = await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${SERVICE_KEY}`,
                },
                body: JSON.stringify(
                  provider === "meta"
                    ? {
                        phone,
                        type: m.message_type,
                        mediaUrl: m.media_url,
                        caption: m.caption || "",
                        message: m.content || "",
                        whatsapp_number_id: whatsappNumberId,
                      }
                    : {
                        phone,
                        mediaUrl: m.media_url,
                        mediaType: m.message_type,
                        caption: m.caption || "",
                        whatsapp_number_id: whatsappNumberId,
                      }
                ),
              });
              const j = await r.json().catch(() => ({}));
              const errDetail = typeof j?.error === "string"
                ? j.error
                : JSON.stringify(j?.error || j?.details || j || {}).slice(0, 300);
              result = {
                success: r.ok && j?.success !== false && !j?.error,
                error: r.ok && !j?.error ? undefined : `[${r.status}] ${errDetail}`,
                messageId: j?.messageId || j?.data?.messageId || j?.data?.id || null,
                status: r.status,
              };
            }
          } catch (sendErr) {
            const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
            result = { success: false, error: `network: ${errMsg}` };
          }

          if (result.success) break;

          console.warn(`[live-trigger] tentativa ${attempt}/${MAX_ATTEMPTS} falhou msg=${m.id} type=${m.message_type} phone=${phone} err=${result.error}`);
          if (attempt < MAX_ATTEMPTS) {
            // Backoff: 2s, 5s
            await sleep(attempt === 1 ? 2000 : 5000);
          }
        }

        if (dispatchId) {
          await supabase
            .from("live_campaign_dispatches")
            .update(
              result.success
                ? { status: "sent", sent_at: new Date().toISOString(), attempts: attempt }
                : { status: "failed", error_message: (result.error || "send_failed").slice(0, 500), attempts: attempt }
            )
            .eq("id", dispatchId);
        }

        if (provider === "meta" && result.success) {
          const displayMessage =
            m.message_type === "text"
              ? m.content || ""
              : m.caption || m.content || `[${m.message_type}]`;

          const { error: logError } = await supabase.from("whatsapp_messages").insert({
            phone,
            message: displayMessage,
            direction: "outgoing",
            message_id: result.messageId || null,
            status: "sent",
            media_type: m.message_type === "text" ? null : m.message_type,
            media_url: m.message_type === "text" ? null : m.media_url,
            is_group: false,
            whatsapp_number_id: whatsappNumberId || null,
          });

          if (logError) {
            console.error(`[live-trigger] erro salvando histórico Meta msg ${m.id}:`, logError);
          }
        }

        if (!result.success) {
          console.error(`[live-trigger] FALHA DEFINITIVA msg=${m.id} type=${m.message_type} phone=${phone} após ${attempt} tentativas:`, result.error);
        }
      }

      // Após o último envio, ativa Modo Jess se habilitado
      if (matched.jess_enabled) {
        try {
          const phoneDigits = phone.replace(/\D/g, "");
          const sessionWhatsappNumberId = whatsappNumberId ?? null;
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

          await supabase.from("automation_ai_sessions").upsert({
            phone: phoneDigits,
            live_campaign_id: matched.id,
            whatsapp_number_id: sessionWhatsappNumberId,
            is_active: true,
            messages_sent: 0,
            max_messages: 5,
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          }, { onConflict: "phone" });

          console.log(`[live-trigger] Modo Jess ativado para ${phone} (number=${sessionWhatsappNumberId ?? "none"})`);

          const aiRes = await fetch(`${SUPABASE_URL}/functions/v1/automation-ai-respond`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              phone: phoneDigits,
              whatsappNumberId: sessionWhatsappNumberId,
              liveCampaignId: matched.id,
            }),
          });

          const aiData = await aiRes.json().catch(() => ({}));
          if (!aiRes.ok || !aiData?.reply) {
            throw new Error(aiData?.error || aiData?.details || "jess_initial_reply_failed");
          }

          const aiReply = String(aiData.reply).trim();
          if (aiReply) {
            const sendEndpoint = provider === "meta" ? "meta-whatsapp-send" : "zapi-send-message";
            const sendPayload = provider === "meta"
              ? { phone, message: aiReply, whatsappNumberId: sessionWhatsappNumberId }
              : { phone, message: aiReply, whatsapp_number_id: sessionWhatsappNumberId };

            const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/${sendEndpoint}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SERVICE_KEY}`,
              },
              body: JSON.stringify(sendPayload),
            });

            const sendData = await sendRes.json().catch(() => ({}));
            if (!sendRes.ok) {
              throw new Error(sendData?.error || sendData?.details || "jess_send_failed");
            }

            await supabase.from("whatsapp_messages").insert({
              phone,
              message: `[IA] ${aiReply}`,
              direction: "outgoing",
              status: "sent",
              message_id: sendData?.messageId || sendData?.data?.messageId || sendData?.data?.id || null,
              whatsapp_number_id: sessionWhatsappNumberId,
            });

            await supabase
              .from("automation_ai_sessions")
              .update({ messages_sent: 1, updated_at: new Date().toISOString() })
              .eq("phone", phoneDigits);
          }
        } catch (jessErr) {
          console.error("[live-trigger] erro ativando Jess:", jessErr);
        }
      }
    };

    // Para canais alternativos (Instagram ou Meta Template), delega ao cron live-campaign-dispatch
    // que já trata as ramificações. Z-API continua com envio inline imediato.
    const usesTemplate = messages.some((m: any) => !!m.meta_template_name);
    const useInlineSender = resolvedChannel === "whatsapp" && !usesTemplate && pref !== "meta_whatsapp";

    if (useInlineSender) {
      // Dispara em background — webhook responde imediatamente
      // @ts-ignore - EdgeRuntime existe no runtime do Supabase
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(sendSequence());
      } else {
        // Fallback: deixa rodar sem await (não bloqueia)
        sendSequence().catch((e) => console.error("[live-trigger] background error:", e));
      }
    } else {
      console.log(`[live-trigger] canal=${resolvedChannel} pref=${pref} usesTemplate=${usesTemplate} — delegando ao cron live-campaign-dispatch`);
    }

    return new Response(
      JSON.stringify({
        matched: true,
        campaign: matched.slug,
        lead_id: leadId,
        dispatched: messages.length,
        mode: useInlineSender ? "direct_send" : "cron_delegated",
        channel: resolvedChannel,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[live-trigger] erro:", msg, stack ? `\nstack: ${stack}` : "", "\nraw:", err);
    return new Response(JSON.stringify({ matched: false, error: msg, stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
