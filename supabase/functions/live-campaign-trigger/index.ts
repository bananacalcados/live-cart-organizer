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
    const { phone, message, sender_name, whatsapp_number_id } = body;

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
      .select("id, name, slug, trigger_phrase, ask_shoe_size, jess_enabled, whatsapp_number_id")
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

    // Anti-duplicação: se já existem despachos pendentes/feitos para esse phone+campaign, ignora
    const { count: dispatchCount } = await supabase
      .from("live_campaign_dispatches")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", matched.id)
      .eq("phone", phone);

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
          source: "live_campaign",
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
          source: "live_campaign",
          temperature: "warm",
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

    // Atualiza contador da campanha
    await supabase.rpc("increment_execution_count", { message_id: matched.id }).catch(() => {});
    await supabase
      .from("live_campaigns")
      .update({ total_leads: (dispatchCount ?? 0) + 1 })
      .eq("id", matched.id);

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
    const dispatchRows = messages.map((m) => ({
      campaign_id: matched.id,
      message_id: m.id,
      lead_id: leadId,
      phone,
      scheduled_at: nowIso,
      status: "pending" as const,
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
      const whatsappNumberId = matched.whatsapp_number_id ?? undefined;

      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const dispatchId = dispatchIdByMessage.get(m.id);

        // Delay antes de cada mensagem (exceto a primeira sai imediata)
        if (i > 0) {
          const delaySec = m.delay_seconds || 2;
          await sleep(delaySec * 1000);
        }

        try {
          let result: { success: boolean; error?: string } = { success: false };

          if (m.message_type === "text") {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/zapi-send-message`, {
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
            result = { success: r.ok && j?.success !== false, error: j?.error };
          } else {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/zapi-send-media`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SERVICE_KEY}`,
              },
              body: JSON.stringify({
                phone,
                mediaUrl: m.media_url,
                mediaType: m.message_type,
                caption: m.caption || "",
                whatsapp_number_id: whatsappNumberId,
              }),
            });
            const j = await r.json().catch(() => ({}));
            result = { success: r.ok && j?.success !== false, error: j?.error };
          }

          if (dispatchId) {
            await supabase
              .from("live_campaign_dispatches")
              .update(
                result.success
                  ? { status: "sent", sent_at: new Date().toISOString() }
                  : { status: "failed", error_message: result.error || "send_failed" }
              )
              .eq("id", dispatchId);
          }

          if (!result.success) {
            console.error(`[live-trigger] falha envio msg ${m.id}:`, result.error);
          }
        } catch (sendErr) {
          const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
          console.error(`[live-trigger] exceção envio msg ${m.id}:`, errMsg);
          if (dispatchId) {
            await supabase
              .from("live_campaign_dispatches")
              .update({ status: "failed", error_message: errMsg })
              .eq("id", dispatchId);
          }
        }
      }

      // Após o último envio, ativa Modo Jess se habilitado
      if (matched.jess_enabled) {
        try {
          const phoneDigits = phone.replace(/\D/g, "");
          const { data: existing } = await supabase
            .from("automation_ai_sessions")
            .select("id")
            .eq("phone", phoneDigits)
            .eq("is_active", true)
            .maybeSingle();
          if (!existing) {
            await supabase.from("automation_ai_sessions").insert({
              phone: phoneDigits,
              live_campaign_id: matched.id,
              is_active: true,
            });
            console.log(`[live-trigger] Modo Jess ativado para ${phone}`);
          }
        } catch (jessErr) {
          console.error("[live-trigger] erro ativando Jess:", jessErr);
        }
      }
    };

    // Dispara em background — webhook responde imediatamente
    // @ts-ignore - EdgeRuntime existe no runtime do Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(sendSequence());
    } else {
      // Fallback: deixa rodar sem await (não bloqueia)
      sendSequence().catch((e) => console.error("[live-trigger] background error:", e));
    }

    return new Response(
      JSON.stringify({
        matched: true,
        campaign: matched.slug,
        lead_id: leadId,
        dispatched: messages.length,
        mode: "direct_send",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[live-trigger] erro:", msg);
    return new Response(JSON.stringify({ matched: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
