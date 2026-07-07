import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveIgAccountByNumberId, globalIgToken } from "../_shared/instagram-account.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API = "https://graph.instagram.com/v25.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { username, message, eventId, fallbackCommentId, fallbackCommentIds, mediaType, whatsapp_number_id } = body;
    let { mediaUrl } = body;

    // Token por conta: se a conversa estiver vinculada a uma instância de
    // Instagram, usa o token daquela conta; senão cai no token global.
    let token = globalIgToken();
    if (whatsapp_number_id) {
      try {
        const acct = await resolveIgAccountByNumberId(supabase, whatsapp_number_id);
        if (acct.accessToken) token = acct.accessToken;
      } catch (e) {
        console.error("[ig-dm-send] erro ao resolver token da conta, usando global:", e);
      }
    }
    if (!token) {
      return new Response(JSON.stringify({ error: "META_PAGE_ACCESS_TOKEN not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lista de comment_ids candidatos para private_reply (mais recentes primeiro).
    // Um comentário de Live só aceita UM private_reply e pode ficar inelegível;
    // por isso tentamos vários em sequência até um funcionar.
    const commentIdCandidates: string[] = Array.from(
      new Set(
        [
          ...(Array.isArray(fallbackCommentIds) ? fallbackCommentIds : []),
          fallbackCommentId,
        ].filter((c): c is string => typeof c === "string" && c.trim().length > 0),
      ),
    );
    if (!username || (!message && !mediaUrl)) {
      return new Response(JSON.stringify({ error: "username and (message or mediaUrl) are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === Áudio: Instagram só aceita mp4/m4a/aac/wav. Webm/ogg/opus são rejeitados pela Meta. ===
    if (mediaUrl && String(mediaType || "").toLowerCase().startsWith("audio")) {
      const lower = String(mediaUrl).toLowerCase();
      const isUnsupportedAudio =
        lower.includes(".webm") || lower.includes(".ogg") || lower.includes(".opus");
      if (isUnsupportedAudio) {
        console.warn("[ig-dm-send] Unsupported audio format for Instagram:", mediaUrl);
        return new Response(JSON.stringify({
          error: "unsupported_audio_format",
          message: "O Instagram rejeitou um áudio em formato não suportado. O app deveria converter automaticamente para WAV antes do envio.",
        }), { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }


    // Monta payload (texto OU attachment de imagem/vídeo/áudio)
    const buildMessagePayload = () => {
      if (mediaUrl && mediaType) {
        const t = String(mediaType).toLowerCase();
        const attachType = t.startsWith("video") ? "video"
          : t.startsWith("audio") ? "audio"
          : "image";
        return { attachment: { type: attachType, payload: { url: mediaUrl, is_reusable: false } } };
      }
      return { text: message };
    };

    function cleanHandleForPath(u: string) {
      return String(u).replace(/^@/, "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
    }

    const cleanUsername = String(username).replace(/^@/, "").trim().toLowerCase();

    // 1) Buscar IG user ID na tabela de vínculos
    let { data: link } = await supabase
      .from("instagram_user_links")
      .select("ig_user_id")
      .ilike("username", cleanUsername)
      .maybeSingle();

    // 2) Fallback: buscar em whatsapp_messages por sender_name
    if (!link?.ig_user_id) {
      const { data: msg } = await supabase
        .from("whatsapp_messages")
        .select("phone")
        .eq("channel", "instagram")
        .ilike("sender_name", `@${cleanUsername}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (msg?.phone && /^\d+$/.test(msg.phone)) {
        link = { ig_user_id: msg.phone };
        await supabase.from("instagram_user_links").upsert(
          { username: cleanUsername, ig_user_id: msg.phone, source: "webhook" },
          { onConflict: "username" }
        );
      }
    }

    let metaResponse: any = null;
    let usedMethod: "direct_dm" | "private_reply" = "direct_dm";

    // Tenta private_reply em sequência sobre todos os comment_ids candidatos.
    // Retorna { ok, data } do primeiro que funcionar, ou o último erro.
    const tryPrivateReply = async (): Promise<{ ok: boolean; data: any; commentId: string | null }> => {
      let lastData: any = null;
      let lastId: string | null = null;
      for (const cid of commentIdCandidates) {
        const r = await fetch(`${META_API}/me/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { comment_id: cid },
            message: buildMessagePayload(),
          }),
        });
        const data = await r.json();
        if (r.ok) return { ok: true, data, commentId: cid };
        console.warn(`[ig-dm-send] private_reply failed for @${cleanUsername} comment ${cid}:`, JSON.stringify(data));
        lastData = data;
        lastId = cid;
      }
      return { ok: false, data: lastData, commentId: lastId };
    };

    // Tenta DM direto se tem o user ID
    if (link?.ig_user_id) {
      const res = await fetch(`${META_API}/me/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: link.ig_user_id },
          message: buildMessagePayload(),
          messaging_type: "RESPONSE",
        }),
      });
      metaResponse = await res.json();
      if (!res.ok) {
        console.warn(`[ig-dm-send] Direct DM failed for @${cleanUsername}, trying private_reply. Error:`, JSON.stringify(metaResponse));
        if (commentIdCandidates.length) {
          const pr = await tryPrivateReply();
          metaResponse = pr.data;
          usedMethod = "private_reply";
          if (!pr.ok) {
            return new Response(JSON.stringify({ error: "Both direct DM and private_reply failed", details: metaResponse }), {
              status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } else {
          return new Response(JSON.stringify({
            error: "Direct DM failed and no comment_id for fallback",
            details: metaResponse,
          }), { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    } else if (commentIdCandidates.length) {
      const pr = await tryPrivateReply();
      metaResponse = pr.data;
      usedMethod = "private_reply";
      if (!pr.ok) {
        return new Response(JSON.stringify({ error: "private_reply failed", details: metaResponse }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      return new Response(JSON.stringify({
        error: "No IG user ID found for this username and no fallbackCommentId provided",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Salvar no histórico — tenta atualizar a linha do echo (mesmo message_id) primeiro,
    // pois o webhook is_echo costuma chegar antes desta resposta e grava sem media_url.
    const recipientId = link?.ig_user_id || metaResponse?.recipient_id || cleanUsername;
    const mid = metaResponse?.message_id || null;
    const payload = {
      phone: recipientId,
      message: message || (mediaUrl ? "[media]" : null),
      direction: "outgoing" as const,
      channel: "instagram",
      status: "sent",
      message_id: mid,
      sender_name: `@${cleanUsername}`,
      media_url: mediaUrl || null,
      media_type: mediaUrl ? (mediaType || null) : "text",
      source: "manual",
    };
    let upgraded = false;
    if (mid) {
      const { data: upd, error: updateError } = await supabase
        .from("whatsapp_messages")
        .update({
          phone: payload.phone,
          message: payload.message,
          media_url: payload.media_url,
          media_type: payload.media_type,
          sender_name: payload.sender_name,
          status: "sent",
        })
        .eq("message_id", mid)
        .select("id");
      if (updateError) {
        console.error("[ig-dm-send] failed to upgrade existing message:", updateError);
      }
      upgraded = !!(upd && upd.length > 0);
    }
    if (!upgraded) {
      // Pequeno atraso para o echo chegar primeiro e evitar duplicata (mídia)
      if (mediaUrl) {
        await new Promise((r) => setTimeout(r, 800));
        if (mid) {
          const { data: upd2, error: updateError2 } = await supabase
            .from("whatsapp_messages")
            .update({
              phone: payload.phone,
              message: payload.message,
              media_url: payload.media_url,
              media_type: payload.media_type,
              sender_name: payload.sender_name,
              status: "sent",
            })
            .eq("message_id", mid)
            .select("id");
          if (updateError2) {
            console.error("[ig-dm-send] failed to upgrade existing media message after delay:", updateError2);
          }
          upgraded = !!(upd2 && upd2.length > 0);
        }
      }
      if (!upgraded) {
        const { error: insertError } = await supabase.from("whatsapp_messages").insert(payload);
        if (insertError) {
          console.error("[ig-dm-send] failed to insert outgoing message:", insertError, payload);
          throw new Error(`Falha ao salvar histórico da mídia: ${insertError.message}`);
        }
      }
    }

    // Registrar em live_comment_dms se temos eventId
    if (eventId && fallbackCommentId) {
      await supabase.from("live_comment_dms").insert({
        event_id: eventId,
        comment_id: fallbackCommentId,
        username: `@${cleanUsername}`,
        message,
        status: "sent",
        meta_message_id: metaResponse?.message_id || null,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      method: usedMethod,
      messageId: metaResponse?.message_id,
      ig_user_id: recipientId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[ig-dm-send] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
