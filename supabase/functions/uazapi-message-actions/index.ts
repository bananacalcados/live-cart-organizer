import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveUazapiCredentials, uazapiInstance, formatUazapiNumber } from "../_shared/uazapi-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * uazapi-message-actions — editar, apagar, marcar como lida e reagir.
 *
 * Body:
 *  - action: 'edit' | 'delete' | 'read' | 'react'
 *  - whatsapp_number_id
 *  - msgId (edit/delete/read/react)
 *  - text (edit)
 *  - emoji (react — vazio remove a reação)
 *  - phone (react/markread — número do chat)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, whatsapp_number_id, msgId, text, emoji, phone } = await req.json();
    const { token } = await resolveUazapiCredentials(whatsapp_number_id);

    let r: { ok: boolean; status: number; data: any };

    if (action === "edit") {
      if (!msgId || !text) return json({ error: "msgId e text são obrigatórios" }, 400);
      r = await uazapiInstance("/message/edit", token, {
        method: "POST",
        body: { messageId: msgId, text },
      });
    } else if (action === "delete") {
      if (!msgId) return json({ error: "msgId é obrigatório" }, 400);
      r = await uazapiInstance("/message/delete", token, {
        method: "POST",
        body: { messageId: msgId },
      });
    } else if (action === "read") {
      if (!msgId) return json({ error: "msgId é obrigatório" }, 400);
      r = await uazapiInstance("/message/markread", token, {
        method: "POST",
        body: { messageId: msgId },
      });
    } else if (action === "react") {
      if (!msgId || !phone) return json({ error: "msgId e phone são obrigatórios" }, 400);
      r = await uazapiInstance("/send/reaction", token, {
        method: "POST",
        body: { number: formatUazapiNumber(phone), messageId: msgId, emoji: emoji ?? "" },
      });
    } else {
      return json({ error: `action inválida: ${action}` }, 400);
    }

    if (!r.ok) return json({ error: "Falha na ação", details: r.data }, r.status);
    return json({ success: true, data: r.data });
  } catch (e) {
    console.error("[uazapi-message-actions] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
