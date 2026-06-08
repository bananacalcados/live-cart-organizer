import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WASENDER_BASE, rehostMedia } from "../_shared/wasender-credentials.ts";
import { logRouting } from "../_shared/routing-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-signature",
};

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v == null) return null;
  return String(v);
}

const MEDIA_KEYS: Record<string, string> = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const ok = () =>
    new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const numberId = url.searchParams.get("number_id");

    const payload = await req.json().catch(() => ({} as Record<string, unknown>));
    console.log("[wasender-webhook] event:", payload?.event, "number_id:", numberId);

    // Resolve a linha local (para validar assinatura e obter api_key de decrypt)
    // is_active guard: só instâncias ATIVAS podem receber. Se a linha não for
    // encontrada por estar INATIVA, `row` fica null e a mensagem vira
    // "não identificada" (igual aos demais provedores) — nunca atribuída.
    let row: { id: string; wasender_webhook_secret: string | null; wasender_api_key: string | null } | null = null;
    if (numberId) {
      const { data } = await supabase
        .from("whatsapp_numbers")
        .select("id, wasender_webhook_secret, wasender_api_key")
        .eq("id", numberId)
        .eq("is_active", true)
        .maybeSingle();
      row = data as typeof row;
    }

    // Verificação de assinatura (X-Webhook-Signature == webhook_secret)
    const signature = req.headers.get("x-webhook-signature");
    if (row?.wasender_webhook_secret) {
      if (!signature || signature !== row.wasender_webhook_secret) {
        console.warn("[wasender-webhook] assinatura inválida");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const event = String(payload?.event || "");
    const data = (payload?.data || {}) as Record<string, unknown>;

    // ── qrcode.updated → salva QR para exibição em tempo real no Admin ──
    if (event === "qrcode.updated" || event === "qr.updated" || event === "qrcode") {
      const qr =
        asString((data as any)?.qrCode) ||
        asString((data as any)?.qr) ||
        asString((data as any)?.code) ||
        asString((payload as any)?.qrCode) ||
        asString((payload as any)?.qr);
      if (numberId && qr) {
        await supabase
          .from("whatsapp_numbers")
          .update({
            wasender_last_qr: qr,
            wasender_qr_updated_at: new Date().toISOString(),
            is_online: false,
          })
          .eq("id", numberId);
      }
      return ok();
    }

    // ── session.status → atualiza is_online ──
    if (event === "session.status" || event.startsWith("session")) {
      const status = String((data as any)?.status || (payload as any)?.status || "").toLowerCase();
      const isOnline = status === "connected";
      const needScan = status === "need_scan" || status === "disconnected" || status === "logged_out";
      if (numberId) {
        const update: Record<string, unknown> = {
          is_online: isOnline,
          last_health_check: new Date().toISOString(),
        };
        // Ao conectar, o QR antigo não serve mais → limpa.
        if (isOnline) {
          update.wasender_last_qr = null;
          update.wasender_qr_updated_at = null;
        }
        if (needScan) update.is_online = false;
        await supabase.from("whatsapp_numbers").update(update).eq("id", numberId);
      }
      return ok();
    }

    // ── messages.update / message-receipt.update → status dos tickets (✓ ✓✓ azul) ──
    if (
      event === "messages.update" ||
      event === "message.status" ||
      event === "messages.status" ||
      event === "message-receipt.update" ||
      event === "messages.receipt.update"
    ) {
      // O payload pode vir como objeto único ou lista (Baileys).
      // IMPORTANTE: o objeto de update tem o formato { update: { status }, key: { id, fromMe } }.
      // NÃO usar `data.update` como entry — isso perde o `key.id` e nenhum ticket é atualizado.
      const entries: any[] = Array.isArray((data as any)?.messages)
        ? (data as any).messages
        : Array.isArray((data as any)?.updates)
          ? (data as any).updates
          : Array.isArray(data)
            ? (data as any)
            : [data];

      // Baileys: status numérico 0=error 1=pending 2=server_ack(sent) 3=delivery_ack(delivered) 4=read 5=played
      const numMap: Record<string, string> = {
        "2": "sent",
        "3": "delivered",
        "4": "read",
        "5": "read",
      };
      const strMap: Record<string, string> = {
        delivery_ack: "delivered",
        delivered: "delivered",
        read: "read",
        played: "read",
        server_ack: "sent",
        sent: "sent",
        pending: "sent",
      };

      for (const upd of entries) {
        if (!upd) continue;
        // O `key` pode estar no próprio entry ou no `data` (payload de objeto único).
        const keyObj = upd?.key || (data as any)?.key || {};
        const id =
          asString(keyObj?.id) ||
          asString(upd?.key?.id) ||
          asString(upd?.id) ||
          asString((data as any)?.id);
        if (!id) continue;

        // Só aplicamos receipts às NOSSAS mensagens enviadas (fromMe). Receipts de
        // mensagens recebidas (fromMe:false) não devem mexer no status do que recebemos.
        const fromMe = keyObj?.fromMe;
        if (fromMe === false) continue;

        const rawStatus =
          upd?.update?.status ?? upd?.status ?? (data as any)?.update?.status ?? (data as any)?.status;
        // Receipts (message-receipt.update) muitas vezes só trazem readTimestamp.
        const receipt = upd?.receipt || (data as any)?.receipt;
        let mapped: string | null = null;

        if (rawStatus != null && rawStatus !== "") {
          const key = String(rawStatus).toLowerCase();
          mapped = numMap[key] || strMap[key] || null;
        }
        if (!mapped && receipt) {
          if (receipt.readTimestamp || receipt.playedTimestamp) mapped = "read";
          else if (receipt.receiptTimestamp || receipt.deliveredTimestamp) mapped = "delivered";
        }
        if (!mapped) continue;

        // Nunca rebaixar o status (read > delivered > sent).
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
        const { data: existing } = await supabase
          .from("whatsapp_messages")
          .select("status")
          .eq("message_id", id)
          .maybeSingle();
        const currentRank = rank[String(existing?.status || "").toLowerCase()] || 0;
        if ((rank[mapped] || 0) < currentRank) continue;

        await supabase
          .from("whatsapp_messages")
          .update({ status: mapped })
          .eq("message_id", id);
      }
      return ok();
    }

    // ── messages.received / messages.upsert → mensagem nova ──
    if (event === "messages.received" || event === "messages.upsert" || event === "message.received") {
      const msg = ((data as any)?.messages || (data as any)?.message || {}) as Record<string, any>;
      const key = (msg?.key || {}) as Record<string, any>;

      const fromMe = Boolean(key?.fromMe);
      const remoteJid = asString(key?.remoteJid) || "";
      const isGroup = remoteJid.includes("@g.us") || Boolean((msg as any)?.isGroup);

      // Participante (quem realmente enviou dentro do grupo)
      const participantPhone =
        asString(key?.cleanedParticipantPn) ||
        asString(key?.participant?.replace?.(/@.*$/, "")) ||
        null;

      // Telefone do chat: em grupos é o ID do grupo (remoteJid); em conversas 1:1 é o remetente
      const cleanedPhone = isGroup
        ? asString(remoteJid.replace(/@.*$/, ""))
        : (asString(key?.cleanedSenderPn) ||
           asString(key?.cleanedParticipantPn) ||
           asString(remoteJid.replace(/@.*$/, "")));

      if (!cleanedPhone) {
        console.warn("[wasender-webhook] sem telefone resolvível, ignorando");
        return ok();
      }

      const messageId = asString(key?.id);
      const messageBody = asString(msg?.messageBody) || "";
      const pushName = asString(msg?.pushName) || asString(key?.pushName) || asString((data as any)?.pushName);

      // Detecta mídia no objeto raw `message`
      const rawMessage = (msg?.message || {}) as Record<string, any>;
      let mediaType: string | null = null;
      let mediaObjKey: string | null = null;
      for (const k of Object.keys(MEDIA_KEYS)) {
        if (rawMessage[k]) {
          mediaType = MEDIA_KEYS[k];
          mediaObjKey = k;
          break;
        }
      }

      // Localização e contato recebidos → renderiza como texto/link no chat
      let extraText: string | null = null;
      if (!mediaType) {
        const loc = rawMessage.locationMessage as Record<string, any> | undefined;
        if (loc && (loc.degreesLatitude != null || loc.degreesLongitude != null)) {
          const lat = loc.degreesLatitude;
          const lng = loc.degreesLongitude;
          const name = asString(loc.name);
          extraText =
            `📍 ${name ? name + "\n" : ""}https://maps.google.com/?q=${lat},${lng}`;
        }
        const contact =
          (rawMessage.contactMessage as Record<string, any> | undefined) ||
          (rawMessage.contactsArrayMessage as Record<string, any> | undefined);
        if (contact) {
          const dn = asString(contact.displayName) || "Contato";
          extraText = `👤 ${dn}`;
        }
      }

      // Monta payload no formato canônico do zapi-webhook
      const zPayload: Record<string, unknown> = {
        phone: cleanedPhone,
        fromMe,
        isGroup,
        messageId,
        senderName: pushName,
        ...(isGroup && participantPhone ? { participantPhone } : {}),
      };


      if (mediaType && mediaObjKey) {
        // Tenta decriptar para obter URL pública
        let publicUrl: string | null = null;
        const mediaObj = rawMessage[mediaObjKey];
        try {
          if (row?.wasender_api_key) {
            const dec = await fetch(`${WASENDER_BASE}/decrypt-media`, {
              method: "POST",
              headers: { Authorization: `Bearer ${row.wasender_api_key}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                data: { messages: { key: { id: messageId }, message: { [mediaObjKey]: mediaObj } } },
              }),
            });
            const decData = await dec.json().catch(() => null);
            publicUrl = decData?.publicUrl || decData?.data?.publicUrl || null;
          }
        } catch (e) {
          console.error("[wasender-webhook] decrypt-media falhou:", e);
        }
        if (!publicUrl) publicUrl = asString(mediaObj?.url);

        const fileName = asString(mediaObj?.fileName);

        // Re-hospeda a mídia (a URL da WaSender expira em ~1h) para que o chat
        // mostre imagens/vídeos/áudios/documentos de forma permanente.
        if (publicUrl) {
          publicUrl = await rehostMedia(publicUrl, mediaType, fileName);
        }

        const caption = asString(mediaObj?.caption) || messageBody || null;
        const mapKeyToField: Record<string, string> = {
          image: "image",
          video: "video",
          audio: "audio",
          document: "document",
          sticker: "sticker",
        };
        const field = mapKeyToField[mediaType] || "document";
        (zPayload as any)[field] = {
          url: publicUrl,
          [`${field}Url`]: publicUrl,
          caption,
          fileName,
        };
        if (caption) zPayload.text = caption;
      } else {
        zPayload.text = extraText || messageBody;
      }

      // is_active guard: se a linha não pôde ser carregada (instância inativa ou
      // inexistente), a mensagem NÃO pode ser atribuída a ela — tratamos como
      // "não identificada", exatamente como o no-match dos outros provedores.
      const effectiveNumberId = row ? numberId : null;

      // Diagnostic: log how this incoming message was routed. WaSender relies on
      // the per-instance ?number_id= param; if it is missing OR points to an
      // inactive instance the message cannot be attributed (saved as "não
      // identificada" downstream).
      if (!fromMe && !isGroup) {
        await logRouting(supabase, {
          provider: "wasender",
          senderPhone: cleanedPhone,
          resolutionMethod: effectiveNumberId ? "query_param" : "none",
          resolvedWhatsappNumberId: effectiveNumberId,
          rawIdentifier: numberId,
          matched: Boolean(effectiveNumberId),
          rawPayload: { event, number_id: numberId, messageId },
        });
      }

      // Reaproveita TODA a lógica existente (dedup, roteamento IA, leads, campanhas, NPS).
      // Marca `via=wasender` para o zapi-webhook não duplicar o log de roteamento.
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/zapi-webhook?number_id=${effectiveNumberId || ""}&via=wasender`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(zPayload),
          },
        );
        console.log("[wasender-webhook] forwarded to zapi-webhook:", res.status);
      } catch (e) {
        console.error("[wasender-webhook] forward falhou:", e);
      }

      return ok();
    }

    // ── groups.update / groups.participants.update → sincroniza grupos conhecidos ──
    if (event === "groups.update" || event === "group-participants.update" || event === "groups.participants.update" || event.startsWith("group")) {
      try {
        // O payload pode trazer um objeto ou uma lista de grupos
        const rawGroups: any[] = Array.isArray((data as any)?.groups)
          ? (data as any).groups
          : Array.isArray(data)
            ? (data as any)
            : [data];

        for (const g of rawGroups) {
          if (!g || typeof g !== "object") continue;
          const groupId = asString(g.id) || asString(g.jid) || asString(g.remoteJid) || asString(g.groupId);
          if (!groupId) continue;

          // Só atualiza grupos que já conhecemos (não cria novos via webhook)
          const { data: known } = await supabase
            .from("whatsapp_groups")
            .select("id, participant_count")
            .eq("group_id", groupId)
            .maybeSingle();
          if (!known) {
            console.log("[wasender-webhook] grupo desconhecido, ignorando:", groupId);
            continue;
          }

          const update: Record<string, unknown> = {
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          const name = asString(g.subject) || asString(g.name);
          if (name) update.name = name;
          const desc = asString(g.desc) || asString(g.description);
          if (desc) update.description = desc;

          // participantes: lista completa ou ações add/remove
          if (Array.isArray(g.participants)) {
            update.previous_participant_count = (known as any).participant_count ?? null;
            update.participant_count = g.participants.length;
          } else if ((event === "group-participants.update" || event === "groups.participants.update") && Array.isArray((data as any)?.participants)) {
            const action = String((data as any)?.action || "").toLowerCase();
            const delta = (data as any).participants.length;
            const prev = (known as any).participant_count ?? 0;
            update.previous_participant_count = prev;
            if (action === "add") update.participant_count = prev + delta;
            else if (action === "remove") update.participant_count = Math.max(0, prev - delta);
          }

          await supabase.from("whatsapp_groups").update(update).eq("group_id", groupId);
        }
      } catch (e) {
        console.error("[wasender-webhook] groups update falhou:", e);
      }
      return ok();
    }

    // ── contacts.update / contacts.upsert → atualiza nome de exibição ──
    if (event === "contacts.update" || event === "contacts.upsert" || event.startsWith("contacts")) {
      try {
        const rawContacts: any[] = Array.isArray((data as any)?.contacts)
          ? (data as any).contacts
          : Array.isArray(data)
            ? (data as any)
            : [data];

        for (const c of rawContacts) {
          if (!c || typeof c !== "object") continue;
          const jid = asString(c.id) || asString(c.jid) || asString(c.remoteJid);
          if (!jid || jid.includes("@g.us")) continue; // ignora grupos
          const rawPhone =
            asString(c.cleanedPn) || asString(c.phone) || asString(jid.replace(/@.*$/, ""));
          if (!rawPhone) continue;
          const name = asString(c.name) || asString(c.notify) || asString(c.pushName) || asString(c.verifiedName);
          if (!name) continue;

          const digits = rawPhone.replace(/\D/g, "");
          const suffix = digits.slice(-8); // match por sufixo de 8 dígitos (regra do projeto)
          if (suffix.length < 8) continue;

          // Atualiza display_name apenas onde ainda não há custom_name definido
          const { data: existing } = await supabase
            .from("chat_contacts")
            .select("id, custom_name")
            .like("phone", `%${suffix}`)
            .limit(5);

          if (existing && existing.length > 0) {
            for (const row of existing) {
              await supabase
                .from("chat_contacts")
                .update({ display_name: name, updated_at: new Date().toISOString() })
                .eq("id", (row as any).id);
            }
          } else {
            await supabase
              .from("chat_contacts")
              .insert({ phone: digits, display_name: name });
          }
        }
      } catch (e) {
        console.error("[wasender-webhook] contacts update falhou:", e);
      }
      return ok();
    }

    // Eventos não tratados → 200
    return ok();

  } catch (e) {
    console.error("[wasender-webhook] error:", e);
    // Sempre 200 para a WaSender não reenviar em loop
    return new Response(JSON.stringify({ received: true, error: (e as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
