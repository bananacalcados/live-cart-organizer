import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routeMessage, isOperatorCooldownActive } from "../_shared/message-router.ts";
import { uazapiInstance, rehostMedia } from "../_shared/uazapi-credentials.ts";
import { logRouting, type ResolutionMethod } from "../_shared/routing-log.ts";
import { processGroupMembershipEvent, recordGroupActivity, type GroupActivityType } from "../_shared/group-member-tracking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AnyObj = Record<string, unknown>;

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v == null) return null;
  return String(v);
}

/** Mapeia o mediaType da uazapi para o tipo genérico do sistema. */
function mapMediaType(t: string | null): string | null {
  switch ((t || "").toLowerCase()) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
    case "ptt":
      return "audio";
    case "sticker":
      return "image"; // stickers são tratados como imagem no sistema
    case "document":
      return "document";
    default:
      return null;
  }
}

/**
 * Normaliza um JID/telefone da uazapi.
 * Indivíduo: `5511999999999@s.whatsapp.net`. Grupo: `<id>@g.us`. LID: `...@lid`.
 */
function normalizeJid(jid: string | null): { phone: string; isGroup: boolean; isLid: boolean } {
  const raw = jid || "";
  const isGroup = raw.includes("@g.us") || raw.endsWith("-group");
  const isLid = raw.includes("@lid");
  // Remove sufixo de servidor e parte de device (:NN)
  let local = raw.split("@")[0].split(":")[0];
  let digits = local.replace(/\D/g, "");

  if (isGroup) {
    return { phone: digits, isGroup: true, isLid: false };
  }

  // Injeção do 9º dígito para números BR (padrão E.164 do projeto)
  if (digits.length >= 10 && digits.length <= 11) digits = "55" + digits;
  if (digits.startsWith("55") && digits.length === 12) {
    const ddd = digits.substring(2, 4);
    const number = digits.substring(4);
    digits = "55" + ddd + "9" + number;
  }

  return { phone: digits, isGroup: false, isLid };
}

/**
 * Resolve whatsapp_number_id.
 * Strong keys first: owner → token (these uniquely identify the real instance).
 * The ?number_id= query param is only a LAST resort and is flagged as suspect,
 * because a shared/misconfigured webhook URL would otherwise send every
 * instance's messages to the same number. When nothing matches, returns
 * numberId=null so the message is saved as "não identificada".
 */
interface UazapiResolution {
  numberId: string | null;
  method: ResolutionMethod;
  rawIdentifier: string | null;
  matched: boolean;
}

/**
 * Variantes do owner para casar com/sem o 9º dígito (BR). A uazapi costuma
 * enviar o owner SEM o nono dígito (12 dígitos), enquanto whatsapp_numbers
 * pode estar armazenado COM (13 dígitos). Geramos ambas as formas.
 */
function ownerVariants(owner: string): string[] {
  const digits = owner.replace(/\D/g, "");
  const variants = new Set<string>([digits]);
  // BR sem nono dígito: 55 + DDD(2) + 8 dígitos = 12 → adiciona variante com 9
  if (digits.startsWith("55") && digits.length === 12) {
    variants.add(digits.slice(0, 4) + "9" + digits.slice(4));
  }
  // BR com nono dígito: 55 + DDD(2) + 9 dígitos = 13 → adiciona variante sem 9
  if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
    variants.add(digits.slice(0, 4) + digits.slice(5));
  }
  return [...variants];
}

async function resolveNumberId(
  supabase: any,
  url: URL,
  payload: AnyObj,
): Promise<UazapiResolution> {
  // 1. owner (strong key) — is_active guard: a match on an INACTIVE instance is
  // treated as no-match → message becomes "não identificada", never attributed.
  const owner = asString(payload.owner) || asString((payload.message as AnyObj)?.owner);
  if (owner) {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id")
      .eq("provider", "uazapi")
      .in("uazapi_owner", ownerVariants(owner))
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (data) return { numberId: data.id as string, method: 'owner', rawIdentifier: owner, matched: true };
    console.warn(`[uazapi-webhook] owner ${owner} não corresponde a instância ATIVA (inativa ou inexistente)`);
  }

  // 2. token (strong key) — same is_active guard
  const token = asString(payload.token);
  if (token) {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("id")
      .eq("provider", "uazapi")
      .eq("uazapi_token", token)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (data) return { numberId: data.id as string, method: 'token', rawIdentifier: owner || token, matched: true };
    console.warn(`[uazapi-webhook] token não corresponde a instância ATIVA (inativa ou inexistente)`);
  }

  // 3. Query param (last resort — may be shared/misconfigured across instances)
  const fromParam = url.searchParams.get("number_id");
  if (fromParam) {
    console.warn(`[uazapi-webhook] resolved via query param (SUSPECT fallback): ${fromParam}`);
    return { numberId: fromParam, method: 'query_param', rawIdentifier: owner || token || fromParam, matched: true };
  }

  console.error("[uazapi-webhook] não foi possível resolver whatsapp_number_id");
  return { numberId: null, method: 'none', rawIdentifier: owner || token || null, matched: false };
}

/** Helpers de envio: usam SEMPRE os senders uazapi (respeita binding de instância). */
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function sendText(phone: string, message: string, numberId: string | null) {
  return fetch(`${SB_URL}/functions/v1/uazapi-send-message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      "x-force-instance": "true",
    },
    body: JSON.stringify({ phone, message, whatsapp_number_id: numberId }),
  });
}

function sendMedia(
  phone: string,
  mediaUrl: string,
  mediaType: string,
  caption: string,
  numberId: string | null,
) {
  return fetch(`${SB_URL}/functions/v1/uazapi-send-media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      "x-force-instance": "true",
    },
    body: JSON.stringify({ phone, mediaUrl, mediaType, caption, whatsapp_number_id: numberId }),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const ok = (extra: AnyObj = {}) =>
    new Response(JSON.stringify({ success: true, ...extra }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(SB_URL, SB_KEY);
    const url = new URL(req.url);
    const payload = (await req.json().catch(() => ({}))) as AnyObj;
    const eventType = (asString(payload.EventType) || asString(payload.event) || "").toLowerCase();
    const instanceToken = asString(payload.token);

    // LOG BRUTO COMO PRIMEIRA AÇÃO (caixa-preta). Nunca pode bloquear o fluxo.
    let rawEventId: string | null = null;
    try {
      const { data: rawRow } = await supabase
        .from("webhook_events_raw")
        .insert({
          provider: "uazapi",
          event_type: eventType || null,
          owner: asString(payload.owner) || null,
          payload,
        })
        .select("id")
        .maybeSingle();
      rawEventId = ((rawRow as AnyObj)?.id as string) ?? null;
    } catch (e) {
      console.error("[uazapi-webhook] raw log falhou:", (e as Error).message);
    }

    // Marca o motivo de descarte nas saídas silenciosas (deixa rastro).
    const markSkip = async (reason: string) => {
      if (!rawEventId) return;
      try {
        await supabase.from("webhook_events_raw").update({ skip_reason: reason }).eq("id", rawEventId);
      } catch (e) {
        console.error("[uazapi-webhook] markSkip falhou:", (e as Error).message);
      }
    };

    console.log(`[uazapi-webhook] event=${eventType} number_id=${url.searchParams.get("number_id")}`);

    const resolution = await resolveNumberId(supabase, url, payload);
    const numberId = resolution.numberId;

    // ───────────────────────── connection / qrcode ─────────────────────────
    if (eventType === "connection" || eventType === "qrcode") {
      if (numberId && instanceToken) {
        try {
          const r = await uazapiInstance("/instance/status", instanceToken, { method: "GET" });
          const inst = r.data?.instance || r.data;
          const statusBlock = r.data?.status || {};
          const statusStr = (inst?.status || "").toString().toLowerCase();
          const isOnline = Boolean(statusBlock?.connected) || statusStr === "connected";
          const qr = inst?.qrcode ?? inst?.qrCode ?? null;
          const update: AnyObj = { is_online: isOnline, last_health_check: new Date().toISOString() };
          if (isOnline) {
            update.uazapi_last_qr = null;
            update.uazapi_qr_updated_at = null;
          } else if (qr) {
            update.uazapi_last_qr = qr;
            update.uazapi_qr_updated_at = new Date().toISOString();
          }
          await supabase.from("whatsapp_numbers").update(update).eq("id", numberId);
        } catch (e) {
          console.error("[uazapi-webhook] connection refresh falhou:", (e as Error).message);
        }
      }
      return ok();
    }

    // ───────────────────────── status updates ─────────────────────────
    if (eventType === "messages_update" || eventType === "message_update") {
      const ev = (payload.event as AnyObj) || {};
      const statusRaw =
        asString(ev.Type) || asString(payload.state) || asString((payload.message as AnyObj)?.status);
      const ids: string[] = Array.isArray(ev.MessageIDs)
        ? (ev.MessageIDs as unknown[]).map((x) => asString(x)).filter(Boolean) as string[]
        : [asString((payload.message as AnyObj)?.messageid) || asString((payload.message as AnyObj)?.id)].filter(Boolean) as string[];
      if (statusRaw && ids.length > 0) {
        const status = statusRaw.toLowerCase();
        for (const mid of ids) {
          const { data: updated } = await supabase
            .from("whatsapp_messages")
            .update({ status })
            .eq("message_id", mid)
            .select("id");
          if (!updated || updated.length === 0) {
            // Race: status can arrive before the outgoing row is inserted. Retry once.
            await new Promise((r) => setTimeout(r, 2000));
            await supabase
              .from("whatsapp_messages")
              .update({ status })
              .eq("message_id", mid);
          }
        }
      }
      return ok();
    }

    // ───────────────────────── contacts ─────────────────────────
    if (eventType === "contacts") {
      const chat = (payload.chat as AnyObj) || {};
      const phoneRaw = asString(chat.phone) || asString(chat.wa_chatid);
      const name = asString(chat.wa_name) || asString(chat.name) || asString(chat.wa_contactName);
      if (phoneRaw && name) {
        const { phone, isGroup } = normalizeJid(phoneRaw);
        if (!isGroup && phone) {
          const suffix = phone.slice(-8);
          const { data: existing } = await supabase
            .from("chat_contacts")
            .select("id, custom_name")
            .like("phone", `%${suffix}`)
            .limit(5);
          if (existing && existing.length > 0) {
            for (const c of existing) {
              await supabase
                .from("chat_contacts")
                .update({ display_name: name, updated_at: new Date().toISOString() })
                .eq("id", (c as AnyObj).id);
            }
          } else {
            await supabase.from("chat_contacts").insert({ phone, display_name: name });
          }
        }
      }
      return ok();
    }

    // ───────────────────────── groups ─────────────────────────
    if (eventType === "groups") {
      const chat = (payload.chat as AnyObj) || {};
      const ev = (payload.event as AnyObj) || {};
      // O payload real da uazapi (whatsmeow GroupInfo) usa `event.JID`; mantemos
      // o fallback antigo em `chat.wa_chatid` por segurança.
      const groupId = (
        (asString(chat.wa_chatid) || asString(ev.JID) || "")
      ).replace("@g.us", "").replace(/\D/g, "");
      const name = asString(chat.wa_name) || asString(chat.name) || asString(ev.Name);
      if (groupId) {
        const { data: known } = await supabase
          .from("whatsapp_groups")
          .select("id")
          .eq("group_id", groupId)
          .maybeSingle();
        if (known) {
          const update: AnyObj = {
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          if (name) update.name = name;
          await supabase.from("whatsapp_groups").update(update).eq("group_id", groupId);
        }
      }
      // Rastreamento de movimentação de membros (entrou/saiu/promovido).
      // Isolado em try/catch interno — nunca derruba o webhook.
      await processGroupMembershipEvent(supabase, payload, numberId);
      return ok();
    }


    // ───────────────────────── messages ─────────────────────────
    if (eventType !== "messages" && eventType !== "message") {
      return ok({ ignored: eventType });
    }

    const message = (payload.message as AnyObj) || {};
    // Salvaguarda extra: nunca reprocessar o que enviamos via API.
    if (message.wasSentByApi === true) {
      await markSkip("wasSentByApi");
      return ok({ skipped: "wasSentByApi" });
    }

    const chatid = asString(message.chatid);
    if (!chatid) {
      await markSkip("no_chatid");
      return ok({ skipped: "no_chatid" });
    }

    const { phone: chatPhone, isGroup, isLid } = normalizeJid(chatid);
    let phone = chatPhone;

    // Resolve telefone real quando o chatid é um LID
    if (isLid && !isGroup) {
      const pn = normalizeJid(asString(message.sender_pn)).phone;
      if (pn) phone = pn;
    }

    const fromMe = Boolean(message.fromMe);
    const messageId = asString(message.messageid) || asString(message.id);
    const uazMediaType = asString(message.mediaType);
    const sysMediaType = mapMediaType(uazMediaType);
    const text = asString(message.text) || "";
    const senderName =
      asString(message.senderName) || asString(message.groupName) || null;
    const statusRaw = asString(message.status);
    const status = statusRaw ? statusRaw.toLowerCase() : fromMe ? "sent" : "received";
    const messageType = (asString(message.messageType) || asString((message as AnyObj).type) || "").toLowerCase();

    /**
     * Classifica o ENGAJAMENTO de um membro num grupo (voto/reação/comentário).
     * Roda em background — nunca segura o webhook nem o derruba.
     */
    const scheduleGroupActivity = (memberPhone: string | null) => {
      if (!isGroup || fromMe || !memberPhone) return;
      // Reação: messageType "reactionmessage" OU campo reaction no payload.
      const reactionEmoji =
        asString((message as AnyObj).reaction) ||
        asString(((message as AnyObj).reaction as AnyObj)?.text) ||
        null;
      const isReaction = messageType.includes("reaction") || Boolean(reactionEmoji);
      // Enquete (voto): messageType "pollupdatemessage" OU campo poll no payload.
      const isPoll = messageType.includes("poll") || Boolean((message as AnyObj).poll);

      let activityType: GroupActivityType;
      let content: string | null;
      if (isPoll) {
        activityType = "poll_vote";
        content = displayMessage || asString((message as AnyObj).poll) || null;
      } else if (isReaction) {
        activityType = "reaction";
        content = reactionEmoji || displayMessage || null;
      } else {
        activityType = "group_message";
        content = displayMessage || null;
      }

      const task = recordGroupActivity(supabase, {
        groupId: chatid,
        instanceId: numberId,
        phone: memberPhone,
        jid: asString(message.sender_pn) || asString(message.sender) || null,
        activityType,
        messageId,
        content,
        senderName,
      });
      try {
        // @ts-ignore EdgeRuntime está disponível no runtime de edge functions da Supabase.
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(task);
      } catch {
        // best-effort
      }
    };

    // Diagnostic: log how incoming (customer) messages were routed to an instance
    if (!fromMe && !isGroup) {
      await logRouting(supabase, {
        provider: "uazapi",
        senderPhone: phone,
        resolutionMethod: resolution.method,
        resolvedWhatsappNumberId: numberId,
        rawIdentifier: resolution.rawIdentifier,
        matched: resolution.matched,
        rawPayload: { owner: payload.owner, token: payload.token ? "***" : null, messageId },
      });
    }

    // Mídia é resolvida em SEGUNDO PLANO (após o insert e o return ok()).
    // No fluxo síncrono media_url é null — o webhook nunca segura a resposta
    // esperando download/rehost (que para vídeos grandes pode levar 30s+).
    const mediaUrl: string | null = null;

    /**
     * Baixa (/message/download) + re-hospeda a mídia e grava media_url na linha
     * já inserida, em background com EdgeRuntime.waitUntil. Nunca bloqueia o 200.
     */
    const scheduleMediaDownload = (rowId: string | null) => {
      if (!rowId || !sysMediaType || !messageId || !instanceToken) return;
      const token = instanceToken;
      const fileName = asString((message.content as AnyObj)?.fileName) || null;
      const task = (async () => {
        try {
          const dl = await uazapiInstance("/message/download", token, {
            method: "POST",
            body: { id: messageId, return_link: true },
          });
          const link = asString(dl.data?.url) || asString(dl.data?.fileURL);
          if (link) {
            const url = await rehostMedia(link, sysMediaType, fileName);
            if (url) {
              await supabase.from("whatsapp_messages").update({ media_url: url }).eq("id", rowId);
            }
          }
        } catch (e) {
          console.error("[uazapi-webhook] download mídia (bg) falhou:", (e as Error).message);
        }
      })();
      try {
        // @ts-ignore EdgeRuntime está disponível no runtime de edge functions da Supabase.
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(task);
      } catch {
        // Sem EdgeRuntime: deixa a task correr solta (best-effort).
      }
    };

    const caption =
      sysMediaType && typeof message.content === "object"
        ? asString((message.content as AnyObj)?.caption)
        : null;
    const displayMessage = text || caption || (sysMediaType ? `📎 ${sysMediaType}` : "");
    if (!displayMessage && !mediaUrl) {
      // Votos de enquete chegam sem texto/mídia: ainda contam como engajamento.
      if (isGroup && !fromMe) {
        const memberPhone =
          normalizeJid(asString(message.sender_pn) || asString(message.sender)).phone || null;
        scheduleGroupActivity(memberPhone);
      }
      await markSkip("empty");
      return ok({ skipped: "empty" });
    }

    const quotedId = asString(message.quoted) || null;

    // ───────── fromMe (enviado pelo celular físico, não via API) ─────────
    if (fromMe) {
      if (messageId && displayMessage) {
        const aiPrefixes = ["[IA]", "[IA-ADS]", "[IA-CONCIERGE]", "[IA-LIVETE]"];
        const toMatch = [displayMessage, ...aiPrefixes.map((p) => `${p} ${displayMessage}`)];
        for (const m of toMatch) {
          const { data: existing } = await supabase.rpc("dedup_outgoing_message", {
            p_phone: phone,
            p_message: m,
            p_whatsapp_number_id: numberId || null,
            p_cutoff_minutes: 5,
          });
          const row = existing?.[0];
          if (row) {
            if (!row.message_id) {
              await supabase
                .from("whatsapp_messages")
                .update({ message_id: messageId, status })
                .eq("id", row.id);
            }
            return ok({ dedup: true });
          }
        }
      }
      const { data: insertedFromMe } = await supabase.from("whatsapp_messages").insert({
        phone,
        message: displayMessage,
        direction: "outgoing",
        message_id: messageId,
        status,
        is_group: isGroup,
        whatsapp_number_id: numberId,
        quoted_message_id: quotedId,
        ...(sysMediaType ? { media_type: sysMediaType, media_url: mediaUrl } : {}),
      }).select("id").maybeSingle();
      scheduleMediaDownload(((insertedFromMe as AnyObj)?.id as string) ?? null);
      return ok();
    }

    // ───────── Mensagem recebida ─────────
    // Dedup por message_id
    if (messageId) {
      const { data: dup } = await supabase
        .from("whatsapp_messages")
        .select("id")
        .eq("message_id", messageId)
        .eq("phone", phone)
        .eq("direction", "incoming")
        .eq("whatsapp_number_id", numberId)
        .limit(1);
      if (dup && dup.length > 0) return ok({ dedup: true });
    }

    const rawParticipant =
      isGroup
        ? normalizeJid(asString(message.sender_pn) || asString(message.sender)).phone || null
        : null;

    const { data: insertedIncoming, error: insErr } = await supabase.from("whatsapp_messages").insert({
      phone,
      message: displayMessage,
      direction: "incoming",
      message_id: messageId,
      status,
      is_group: isGroup,
      sender_name: senderName,
      sender_phone: rawParticipant,
      whatsapp_number_id: numberId,
      quoted_message_id: quotedId,
      ...(sysMediaType ? { media_type: sysMediaType, media_url: mediaUrl } : {}),
    }).select("id").maybeSingle();

    if (insErr) {
      if ((insErr as unknown as AnyObj).code === "23505") return ok({ dedup: true });
      console.error("[uazapi-webhook] erro ao salvar incoming:", insErr);
    } else {
      scheduleMediaDownload(((insertedIncoming as AnyObj)?.id as string) ?? null);
      // Engajamento em grupo (voto/reação/comentário) → lead scoring.
      scheduleGroupActivity(rawParticipant);
      // Detecta sinais de indicação (cupom / telefone) — fire & forget
      fetch(`${SB_URL}/functions/v1/referral-detect-incoming`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from_phone: phone, message_text: displayMessage }),
      }).catch(() => {});
    }


    // Reabre conversas finalizadas
    if (!isGroup) {
      await supabase.rpc("reopen_finished_conversation", { p_phone: phone }).then(
        () => {},
        () => {},
      );
    }

    // NPS (apenas individual + texto numérico 0..10)
    if (!isGroup && text) {
      const score = Number(text.trim());
      if (!Number.isNaN(score) && score >= 0 && score <= 10) {
        const { data: openSurvey } = await supabase
          .from("chat_nps_surveys")
          .select("id")
          .eq("phone", phone)
          .is("responded_at", null)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (openSurvey) {
          await supabase
            .from("chat_nps_surveys")
            .update({ score, responded_at: new Date().toISOString() })
            .eq("id", openSurvey.id);
        }
      }
    }

    // Contatos + captura de leads
    if (senderName && !isGroup) {
      await supabase
        .from("chat_contacts")
        .upsert({ phone, display_name: senderName }, { onConflict: "phone", ignoreDuplicates: false });

      // Lead de anúncio (keyword)
      try {
        const { data: adKeywords } = await supabase
          .from("whatsapp_ad_keywords")
          .select("keyword, campaign_label")
          .eq("is_active", true);
        if (adKeywords && adKeywords.length > 0 && text) {
          const msgLower = text.toLowerCase();
          const matched = adKeywords.find((kw: AnyObj) =>
            msgLower.includes(String(kw.keyword).toLowerCase()),
          );
          if (matched) {
            const phoneSuffix = phone.slice(-8);
            const { data: existingCustomer } = await supabase
              .from("pos_customers")
              .select("id")
              .or(`whatsapp.ilike.%${phoneSuffix}`)
              .limit(1)
              .maybeSingle();
            await supabase.from("lp_leads").insert({
              name: senderName || null,
              phone,
              campaign_tag: (matched as AnyObj).campaign_label,
              source: "whatsapp_ad",
              converted: false,
              metadata: {
                campaign_label: (matched as AnyObj).campaign_label,
                keyword_matched: (matched as AnyObj).keyword,
                original_message: text.slice(0, 500),
                lead_status: existingCustomer ? "customer" : "prospect",
                captured_at: new Date().toISOString(),
              },
            });
          }
        }
      } catch (e) {
        console.error("[uazapi-webhook] ad-lead erro:", (e as Error).message);
      }

      // Trigger de campanha de Live (fire & forget)
      if (text) {
        fetch(`${SB_URL}/functions/v1/live-campaign-trigger`, {
          method: "POST",
          headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ phone, message: text, sender_name: senderName, whatsapp_number_id: numberId }),
        }).catch(() => {});
      }

      // Lead orgânico (contato não-cliente em campanha semanal)
      try {
        const suffix8 = phone.slice(-8);
        const [{ data: zoppyMatch }, { data: posMatch }] = await Promise.all([
          supabase.from("crm_customers_v").select("id").or(`phone.ilike.%${suffix8}`).limit(1).maybeSingle(),
          supabase.from("pos_customers").select("id").or(`whatsapp.ilike.%${suffix8}`).limit(1).maybeSingle(),
        ]);
        if (!zoppyMatch && !posMatch) {
          const now = new Date();
          const d = now.getDate();
          const weekNum = d <= 7 ? 1 : d <= 14 ? 2 : d <= 21 ? 3 : 4;
          const mm = String(now.getMonth() + 1).padStart(2, "0");
          const yy = String(now.getFullYear()).slice(-2);
          const campaignTag = `contato-whats-${weekNum}-${mm}-${yy}`;
          const { data: existingLead } = await supabase
            .from("lp_leads")
            .select("id, campaign_tag")
            .eq("phone", phone)
            .like("campaign_tag", "contato-whats-%")
            .limit(1)
            .maybeSingle();
          if (existingLead) {
            if (existingLead.campaign_tag !== campaignTag) {
              await supabase
                .from("lp_leads")
                .update({ campaign_tag: campaignTag, name: senderName || existingLead.campaign_tag })
                .eq("id", existingLead.id);
            }
          } else {
            await supabase.from("lp_leads").insert({
              name: senderName || null,
              phone,
              campaign_tag: campaignTag,
              source: "organic_whatsapp",
              converted: false,
              metadata: { captured_at: new Date().toISOString() },
            });
          }
        }
      } catch (e) {
        console.error("[uazapi-webhook] organic-lead erro:", (e as Error).message);
      }
    }

    // Nome de grupo — usar SOMENTE o nome real do grupo (message.groupName),
    // NUNCA o nome do remetente (senderName). Caso o nome do grupo seja
    // desconhecido nesta mensagem, não sobrescreve o display_name existente,
    // evitando que o card do grupo fique com o nome da última pessoa que falou.
    if (isGroup) {
      const realGroupName = asString(message.groupName) || null;
      if (realGroupName) {
        await supabase
          .from("chat_contacts")
          .upsert({ phone, display_name: realGroupName }, { onConflict: "phone", ignoreDuplicates: false });
      }
    }

    // ───────── AUTO-REPLY ─────────
    if (!isGroup) {
      try {
        const { data: autoReplies } = await supabase
          .from("whatsapp_auto_replies")
          .select("*")
          .eq("whatsapp_number_id", numberId)
          .eq("is_active", true);
        const nowDate = new Date();
        const currentTime = nowDate.toTimeString().slice(0, 5);
        const currentDay = nowDate.getDay();
        for (const reply of autoReplies || []) {
          let shouldSend = false;
          if (reply.type === "welcome") {
            const { data: log } = await supabase
              .from("whatsapp_auto_reply_log")
              .select("id")
              .eq("phone", phone)
              .eq("whatsapp_number_id", numberId)
              .eq("type", "welcome")
              .gte("sent_at", new Date(nowDate.getTime() - 24 * 60 * 60 * 1000).toISOString())
              .limit(1);
            if (!log || log.length === 0) shouldSend = true;
          }
          if (reply.type === "away") {
            const isWorkDay = (reply.schedule_days as number[]).includes(currentDay);
            const isWorkHour =
              reply.schedule_start && reply.schedule_end
                ? currentTime >= reply.schedule_start && currentTime <= reply.schedule_end
                : true;
            if (!isWorkDay || !isWorkHour) {
              const { data: log } = await supabase
                .from("whatsapp_auto_reply_log")
                .select("id")
                .eq("phone", phone)
                .eq("whatsapp_number_id", numberId)
                .eq("type", "away")
                .gte("sent_at", new Date(nowDate.getTime() - 4 * 60 * 60 * 1000).toISOString())
                .limit(1);
              if (!log || log.length === 0) shouldSend = true;
            }
          }
          if (shouldSend) {
            sendText(phone, reply.message, numberId).catch((e) =>
              console.error("[uazapi-webhook] auto-reply send:", e),
            );
            await supabase.from("whatsapp_messages").insert({
              phone,
              message: reply.message,
              direction: "outgoing",
              status: "sent",
              whatsapp_number_id: numberId,
              channel: "whatsapp",
            });
            await supabase.from("whatsapp_auto_reply_log").insert({
              phone,
              whatsapp_number_id: numberId,
              type: reply.type,
            });
          }
        }
      } catch (e) {
        console.error("[uazapi-webhook] auto-reply erro:", (e as Error).message);
      }
    }

    // ───────── ROTEADOR CENTRAL ─────────
    if (!isGroup && (text || sysMediaType)) {
      const routeText = text || caption || (sysMediaType ? `[${sysMediaType}]` : "");
      const route = await routeMessage(supabase, { phone, messageText: routeText, isGroup, whatsappNumberId: numberId });
      console.log(`[uazapi-router] ${phone} → ${route.agent} (${route.reason})`);

      switch (route.agent) {
        case "livete":
          fetch(`${SB_URL}/functions/v1/livete-respond`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ phone, messageText: routeText, whatsappNumberId: numberId, mediaUrl, mediaType: sysMediaType }),
          }).catch((e) => console.error("livete-respond:", e));
          break;

        case "continue_session": {
          const cooldown = await isOperatorCooldownActive(supabase, phone);
          if (!cooldown && route.session) {
            const aiRes = await fetch(`${SB_URL}/functions/v1/automation-ai-respond`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: route.session.prompt, phone, messageText: routeText, mediaUrl, mediaType: sysMediaType, whatsappNumberId: numberId }),
            });
            const aiData = await aiRes.json();
            if (aiRes.ok && aiData.reply) {
              const delay = Math.min(Math.max(aiData.reply.length * 50, 2000), 12000);
              await new Promise((r) => setTimeout(r, delay));
              await sendText(phone, aiData.reply, numberId);
              await supabase.from("whatsapp_messages").insert({
                phone, message: `[IA] ${aiData.reply}`, direction: "outgoing", status: "sent", whatsapp_number_id: numberId,
              });
              const newCount = (route.session.messages_sent || 0) + 1;
              if (newCount >= (route.session.max_messages || 50)) {
                await supabase.from("automation_ai_sessions").update({ is_active: false, messages_sent: newCount }).eq("id", route.session.id);
              } else {
                await supabase.from("automation_ai_sessions").update({ messages_sent: newCount, updated_at: new Date().toISOString() }).eq("id", route.session.id);
              }
            }
          }
          break;
        }

        case "ads": {
          const adsCooldown = await isOperatorCooldownActive(supabase, phone);
          if (!adsCooldown) {
            try {
              const adsRes = await fetch(`${SB_URL}/functions/v1/automation-ai-ads-respond`, {
                method: "POST",
                headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ phone, messageText: routeText, campaignId: route.adCampaignId, whatsappNumberId: numberId, channel: "uazapi" }),
              });
              const adsData = await adsRes.json();
              if (adsRes.ok && adsData.keywordMediaUrl) {
                const delay = Math.min(Math.max((adsData.reply || "").length * 50, 2000), 12000);
                await new Promise((r) => setTimeout(r, delay));
                await sendMedia(phone, adsData.keywordMediaUrl, adsData.keywordMediaType || "document", adsData.keywordMediaCaption || "", numberId);
                await supabase.from("whatsapp_messages").insert({
                  phone, message: `[IA-ADS] 📎 ${adsData.keywordMediaCaption || "arquivo"}`, direction: "outgoing",
                  status: "sent", whatsapp_number_id: numberId, media_url: adsData.keywordMediaUrl, media_type: adsData.keywordMediaType,
                });
              }
              if (adsRes.ok && adsData.reply && adsData.reply.trim()) {
                await sendText(phone, adsData.reply, numberId);
                await supabase.from("whatsapp_messages").insert({
                  phone, message: `[IA-ADS] ${adsData.reply}`, direction: "outgoing", status: "sent", whatsapp_number_id: numberId,
                });
              }
            } catch (e) {
              console.error("[uazapi-router] ads-respond:", e);
            }
          }
          break;
        }

        case "concierge":
          fetch(`${SB_URL}/functions/v1/concierge-respond`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ phone, messageText: displayMessage, whatsappNumberId: numberId, channel: "uazapi", mediaUrl, mediaType: sysMediaType }),
          }).catch((e) => console.error("concierge-respond:", e));
          break;

        case "none":
          break;

        case "legacy":
        default:
          fetch(`${SB_URL}/functions/v1/automation-trigger-incoming`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ phone, messageText: displayMessage, instance: "uazapi", isGroup, whatsappNumberId: numberId }),
          }).catch((e) => console.error("automation-trigger-incoming:", e));
          break;
      }
    }

    return ok();
  } catch (e) {
    console.error("[uazapi-webhook] error:", e);
    // Sempre 200 para a uazapi não reenviar em loop.
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
