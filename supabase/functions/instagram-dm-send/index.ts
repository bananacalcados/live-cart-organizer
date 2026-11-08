import { withAccessLog, verifiedIdentity } from "../_shared/withAccessLog.ts";
import { requireStaffOrInternal } from "../_shared/staff-or-internal.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveIgAccountByNumberId, preferredIgToken } from "../_shared/instagram-account.ts";
import { instagramManualMode, instagramFollowupMode, instagramMessagingFields } from "../_shared/instagram-window.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API = "https://graph.instagram.com/v25.0";

Deno.serve(withAccessLog("instagram-dm-send", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
// Fase 4 auth: funcionário com módulo ou chamada interna (service_role + x-internal-call).
{ const denied = await requireStaffOrInternal(req, ["chat","pos","events","marketing","expedition"], false); if (denied) return denied; }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    );

    const body = await req.json();
    const identity=await verifiedIdentity(req);
    const manual=body.manual===true && !!identity && !body.liveFollowup;
    const { username, message, eventId, fallbackCommentId, fallbackCommentIds, mediaType, whatsapp_number_id } = body;
    let { mediaUrl } = body;
    if (typeof username !== 'string' || username.length>100 || (message != null && (typeof message !== 'string' || message.length>4000))) return new Response(JSON.stringify({error:'invalid_input'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
    const ctxResult=await supabase.rpc('instagram_reply_context',{p_username:username,p_event_id:eventId || null,p_number_id:whatsapp_number_id || null});
    if(ctxResult.error)throw ctxResult.error;
    let replyContext=ctxResult.data;
    const mode=body.liveFollowup ? instagramFollowupMode(replyContext,Number(body.followupStep || 0)) : instagramManualMode(replyContext,manual);
    if(!['direct_dm','private_reply','human_agent'].includes(mode)) return new Response(JSON.stringify({error:mode,message:mode==='live_ended_no_private_reply'?'A live terminou: comentário não abre a janela de 24h e a resposta privada só funciona durante a transmissão. Aguarde ela mandar uma mensagem.':manual&&!replyContext.human_agent_approved?'Sem janela de 24h. Resposta humana até 7 dias: aguardando aprovação da Meta.':'Sem janela de 24h e sem comentário elegível não respondido. Aguarde ela mandar uma mensagem.'}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
    const resolvedNumberId=replyContext.number_id || whatsapp_number_id;
    let quickReply:{content_type:string;title:string;payload:string}|null=null;
    if(body.followupJobId){
      if(identity || !body.liveFollowup)return new Response(JSON.stringify({error:'internal_only'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}});
      const {data:job,error}=await supabase.from('live_followup_jobs').select('id,step,status,instagram,whatsapp_number_id').eq('id',body.followupJobId).maybeSingle();
      if(error || !job || job.step!==0 || job.status!=='processing' || job.instagram!==username.replace(/^@/,'').toLowerCase() || job.whatsapp_number_id!==resolvedNumberId)throw new Error('invalid_button_job');
      const {data:settings}=await supabase.from('live_followup_settings').select('value').eq('id',true).single();
      quickReply={content_type:'text',title:String(settings?.value?.types?.F?.button_title || 'Quero meu link 🛍️').slice(0,20),payload:`livef:${job.id}`};
    }

    // Token por conta: se a conversa estiver vinculada a uma instância de
    // Instagram, usa o token daquela conta. Sem instância (ex.: resposta a
    // comentário), usa o token de uma conta de Instagram ativa cadastrada —
    // o secret global META_PAGE_ACCESS_TOKEN fica só como último recurso,
    // pois costuma ficar desatualizado em relação aos tokens por conta.
    let token = "";
    if (resolvedNumberId) {
      try {
        const acct = await resolveIgAccountByNumberId(supabase, resolvedNumberId);
        if (acct.accessToken) token = acct.accessToken;
      } catch (e) {
        console.error("[ig-dm-send] erro ao resolver token da conta:", e);
      }
    }
    if (!token) token = await preferredIgToken(supabase);
    if (!token) {
      return new Response(JSON.stringify({ error: "Nenhum token de Instagram configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lista de comment_ids candidatos para private_reply (mais recentes primeiro).
    // Um comentário de Live só aceita UM private_reply e pode ficar inelegível;
    // por isso tentamos vários em sequência até um funcionar.
    const commentIdCandidates: string[] = Array.from(
      new Set(
        [
          ...replyContext.comment_ids.filter((id:string)=>!body.liveFollowup || replyContext.live_comment_ids.includes(id)),
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
      return { text: message,...(quickReply?{quick_replies:[quickReply]}:{}) };
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
    let usedCommentId: string | null = null;

    // Tenta private_reply em sequência sobre todos os comment_ids candidatos.
    // Retorna { ok, data } do primeiro que funcionar, ou o último erro.
    const tryPrivateReply = async (): Promise<{ ok: boolean; data: any; commentId: string | null }> => {
      let lastData: any = null;
      let lastId: string | null = null;
      for (const cid of commentIdCandidates) {
        const claim=await supabase.rpc('instagram_private_reply_claim',{p_comment_id:cid,p_username:username,p_event_id:eventId || null,p_number_id:resolvedNumberId || null,p_message:message || '[media]'});
        if(claim.error)throw claim.error;
        if(!claim.data)continue;
        let r: Response;
        try { r = await fetch(`${META_API}/me/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { comment_id: cid },
            message: buildMessagePayload(),
          }),
        }); } catch (error) {
          await supabase.from('live_comment_dms').update({status:'uncertain',error_details:'provider_response_unknown'}).eq('comment_id',cid).eq('status','processing');
          throw error;
        }
        const data = await r.json();
        const persist=await supabase.from('live_comment_dms').update({status:r.ok?'sent':'uncertain',meta_message_id:data?.message_id || null,error_details:r.ok?null:JSON.stringify(data).slice(0,2000)}).eq('comment_id',cid).eq('status','processing');
        if(persist.error)throw new Error('private_reply_history_uncertain');
        if (r.ok) { usedCommentId=cid; return { ok: true, data, commentId: cid }; }
        console.warn(`[ig-dm-send] private_reply failed for @${cleanUsername} comment ${cid}:`, JSON.stringify(data));
        lastData = data;
        lastId = cid;
      }
      return { ok: false, data: lastData, commentId: lastId };
    };

    // Tenta DM direto se tem o user ID
    if (link?.ig_user_id && (mode==='direct_dm' || mode==='human_agent')) {
      const res = await fetch(`${META_API}/me/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: link.ig_user_id },
          message: buildMessagePayload(),
          ...instagramMessagingFields(mode),
        }),
      });
      metaResponse = await res.json();
      if (!res.ok) {
        console.warn(`[ig-dm-send] Direct DM failed for @${cleanUsername}, trying private_reply. Error:`, JSON.stringify(metaResponse));
        const windowClosed = metaResponse?.error?.error_subcode === 2534022;
        const directErr = metaResponse;
        if (commentIdCandidates.length) {
          const pr = await tryPrivateReply();
          metaResponse = pr.data;
          usedMethod = "private_reply";
          if (!pr.ok) {
            return new Response(JSON.stringify({
              error: "send_failed",
              message: windowClosed
                ? "Não foi possível enviar: a janela de 24h do direct fechou e o comentário dela já foi respondido (ou expirou). Aguarde ela responder ou comentar de novo."
                : "O Instagram recusou o envio (direct e resposta ao comentário). Tente novamente mais tarde.",
              details: { direct: directErr, private_reply: metaResponse },
            }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        } else {
          return new Response(JSON.stringify({
            error: "send_failed",
            message: windowClosed
              ? "Não foi possível enviar: a janela de 24h do direct fechou. Aguarde ela responder ou comentar de novo."
              : "O Instagram recusou o envio do direct.",
            details: metaResponse,
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    } else if (commentIdCandidates.length) {
      const pr = await tryPrivateReply();
      metaResponse = pr.data;
      usedMethod = "private_reply";
      if (!pr.ok) {
        return new Response(JSON.stringify({
          error: "send_failed",
          message: "Não foi possível responder pelo comentário (já respondido ou expirado). Aguarde ela responder ou comentar de novo.",
          details: metaResponse,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      return new Response(JSON.stringify({
        error: "No IG user ID found for this username and no fallbackCommentId provided",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Salvar no histórico — tenta atualizar a linha do echo (mesmo message_id) primeiro,
    // pois o webhook is_echo costuma chegar antes desta resposta e grava sem media_url.
    const recipientId = link?.ig_user_id || metaResponse?.recipient_id || cleanUsername;
    if(!link?.ig_user_id && typeof recipientId==='string' && /^\d{5,20}$/.test(recipientId)){
      const binding=await supabase.from('instagram_user_links').upsert({username:cleanUsername,ig_user_id:recipientId,source:'webhook'},{onConflict:'username',ignoreDuplicates:true});
      if(binding.error)throw new Error('private_reply_identity_uncertain');
    }
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
      source: manual ? 'manual' : body.liveFollowup ? 'live_followup' : 'automation',
      sender_user_id: manual ? identity?.userId : null,
      whatsapp_number_id: resolvedNumberId || null,
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
    // Private reply is recorded atomically by its actual used comment, not by the caller's hint.

    return new Response(JSON.stringify({
      success: true,
      method: usedMethod,
      commentId: usedCommentId,
      messageId: metaResponse?.message_id,
      ig_user_id: recipientId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[ig-dm-send] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
