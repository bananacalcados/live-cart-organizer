import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WASENDER_BASE, rehostMedia } from "../_shared/wasender-credentials.ts";

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
    let row: { id: string; wasender_webhook_secret: string | null; wasender_api_key: string | null } | null = null;
    if (numberId) {
      const { data } = await supabase
        .from("whatsapp_numbers")
        .select("id, wasender_webhook_secret, wasender_api_key")
        .eq("id", numberId)
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

    // ── session.status → atualiza is_online ──
    if (event === "session.status" || event.startsWith("session")) {
      const status = String((data as any)?.status || (payload as any)?.status || "").toLowerCase();
      const isOnline = status === "connected";
      if (numberId) {
        await supabase
          .from("whatsapp_numbers")
          .update({ is_online: isOnline, last_health_check: new Date().toISOString() })
          .eq("id", numberId);
      }
      return ok();
    }

    // ── messages.update → atualiza status (✓✓) ──
    if (event === "messages.update" || event === "message.status" || event === "messages.status") {
      const upd = (data as any)?.messages || (data as any)?.update || data;
      const id = asString(upd?.key?.id) || asString(upd?.id) || asString((data as any)?.id);
      const newStatus = String(upd?.status || (data as any)?.status || "").toLowerCase();
      if (id && newStatus) {
        const map: Record<string, string> = {
          delivery_ack: "delivered",
          delivered: "delivered",
          read: "read",
          played: "read",
          server_ack: "sent",
          sent: "sent",
        };
        const mapped = map[newStatus] || newStatus;
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

      // Telefone limpo (recomendado pela doc): cleanedSenderPn / cleanedParticipantPn
      const cleanedPhone =
        asString(key?.cleanedParticipantPn) ||
        asString(key?.cleanedSenderPn) ||
        asString(remoteJid.replace(/@.*$/, ""));

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

      // Monta payload no formato canônico do zapi-webhook
      const zPayload: Record<string, unknown> = {
        phone: cleanedPhone,
        fromMe,
        isGroup,
        messageId,
        senderName: pushName,
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
          fileName: asString(mediaObj?.fileName),
        };
        if (caption) zPayload.text = caption;
      } else {
        zPayload.text = messageBody;
      }

      // Reaproveita TODA a lógica existente (dedup, roteamento IA, leads, campanhas, NPS)
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/zapi-webhook?number_id=${numberId || ""}`,
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
