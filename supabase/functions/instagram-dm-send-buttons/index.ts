import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveIgAccountByNumberId, globalIgToken } from "../_shared/instagram-account.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API = "https://graph.instagram.com/v25.0";

/**
 * Envia uma mensagem do Instagram Direct com botões (Generic Template).
 * - buttons: até 3, cada um { type: 'web_url' | 'postback', title, url?, payload? }
 * - Requer conversa aberta com o cliente (janela 24h) — private_reply do IG não
 *   suporta template com botões. Se falhar, o chamador cai no fallback de texto.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      igUserId: rawIgUserId,
      username,
      text,
      buttons,
      whatsapp_number_id,
      eventId,
    } = body as {
      igUserId?: string;
      username?: string;
      text: string;
      buttons: Array<{
        type: "web_url" | "postback";
        title: string;
        url?: string;
        payload?: string;
      }>;
      whatsapp_number_id?: string;
      eventId?: string;
    };

    if (!text || !Array.isArray(buttons) || buttons.length === 0) {
      return new Response(JSON.stringify({ error: "text and buttons are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve IG user id
    let igUserId = rawIgUserId || null;
    if (!igUserId && username) {
      const cleanUsername = String(username).replace(/^@/, "").trim().toLowerCase();
      const { data: link } = await supabase
        .from("instagram_user_links")
        .select("ig_user_id")
        .ilike("username", cleanUsername)
        .maybeSingle();
      if (link?.ig_user_id) igUserId = link.ig_user_id;
      if (!igUserId) {
        const { data: msg } = await supabase
          .from("whatsapp_messages")
          .select("phone")
          .eq("channel", "instagram")
          .ilike("sender_name", `@${cleanUsername}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (msg?.phone && /^\d+$/.test(msg.phone)) igUserId = msg.phone;
      }
    }
    if (!igUserId) {
      return new Response(JSON.stringify({ error: "IG user id not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Token
    let token = globalIgToken();
    if (whatsapp_number_id) {
      try {
        const acct = await resolveIgAccountByNumberId(supabase, whatsapp_number_id);
        if (acct.accessToken) token = acct.accessToken;
      } catch (e) {
        console.error("[ig-dm-buttons] token resolve failed:", e);
      }
    }
    if (!token) {
      return new Response(JSON.stringify({ error: "META_PAGE_ACCESS_TOKEN not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sanitizedButtons = buttons.slice(0, 3).map((b) => {
      const title = String(b.title || "").slice(0, 20) || "Ver";
      if (b.type === "web_url" && b.url) return { type: "web_url", title, url: b.url };
      return { type: "postback", title, payload: String(b.payload || "").slice(0, 1000) };
    });

    const payload = {
      recipient: { id: igUserId },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: String(text).slice(0, 640),
            buttons: sanitizedButtons,
          },
        },
      },
    };

    const res = await fetch(`${META_API}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn("[ig-dm-buttons] send failed:", res.status, JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "Send failed", status: res.status, details: data }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Log outgoing (best-effort)
    try {
      await supabase.from("whatsapp_messages").insert({
        phone: igUserId,
        message: text,
        direction: "outgoing",
        channel: "instagram",
        status: "sent",
        message_id: data?.message_id || null,
        sender_name: username ? `@${String(username).replace(/^@/, "").toLowerCase()}` : null,
        media_type: "text",
        source: "manual",
        whatsapp_number_id: whatsapp_number_id || null,
      });
    } catch (e) {
      console.error("[ig-dm-buttons] failed to log message:", e);
    }

    return new Response(
      JSON.stringify({ success: true, messageId: data?.message_id, eventId: eventId || null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[ig-dm-buttons] error:", err);
    return new Response(JSON.stringify({ error: err?.message || "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
