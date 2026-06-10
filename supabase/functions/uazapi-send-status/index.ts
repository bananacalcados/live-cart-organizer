import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveUazapiCredentials, uazapiInstance } from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type StatusType = "text" | "image" | "video";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { whatsapp_number_id, type, text, mediaUrl, caption } = await req.json();

    const statusType = (type || "").toLowerCase() as StatusType;
    if (!["text", "image", "video"].includes(statusType)) {
      return new Response(
        JSON.stringify({ error: "type deve ser 'text', 'image' ou 'video'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (statusType === "text" && (!text || !String(text).trim())) {
      return new Response(JSON.stringify({ error: "text é obrigatório para status de texto" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((statusType === "image" || statusType === "video") && !mediaUrl) {
      return new Response(
        JSON.stringify({ error: "mediaUrl é obrigatório para status de imagem/vídeo" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Status é por INSTÂNCIA, não por conversa: sem instance-guard.
    const { token } = await resolveUazapiCredentials(whatsapp_number_id);

    // Monta o payload conforme o tipo. A uazapi usa /send/status com `type`.
    const payload: Record<string, unknown> = { type: statusType };
    if (statusType === "text") {
      payload.text = String(text).trim();
    } else {
      payload.file = mediaUrl;
      if (caption) payload.text = caption;
    }

    const r = await uazapiInstance("/send/status", token, { method: "POST", body: payload });
    if (!r.ok) {
      console.error("uazapi send-status error:", r.data);
      return new Response(
        JSON.stringify({ error: "Falha ao publicar status", details: r.data }),
        { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const messageId =
      r.data?.messageid || r.data?.id || r.data?.message?.messageid || r.data?.message?.id || null;
    return new Response(JSON.stringify({ success: true, messageId, data: r.data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Erro ao publicar status uazapi:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
