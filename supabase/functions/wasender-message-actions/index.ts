import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveWasenderCredentials, WASENDER_BASE } from "../_shared/wasender-credentials.ts";

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
 * wasender-message-actions — editar, apagar e marcar como lida.
 *
 * Body:
 *  - action: 'edit' | 'delete' | 'read'
 *  - whatsapp_number_id
 *  - msgId (edit/delete)
 *  - text (edit)
 *  - messageIds: string[] (read)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, whatsapp_number_id, msgId, text, messageIds } = await req.json();
    const { apiKey } = await resolveWasenderCredentials(whatsapp_number_id);
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    let res: Response;
    if (action === "edit") {
      if (!msgId || !text) return json({ error: "msgId e text são obrigatórios" }, 400);
      res = await fetch(`${WASENDER_BASE}/messages/${msgId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ text }),
      });
    } else if (action === "delete") {
      if (!msgId) return json({ error: "msgId é obrigatório" }, 400);
      res = await fetch(`${WASENDER_BASE}/messages/${msgId}`, { method: "DELETE", headers });
    } else if (action === "read") {
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return json({ error: "messageIds é obrigatório" }, 400);
      }
      res = await fetch(`${WASENDER_BASE}/messages/read`, {
        method: "POST",
        headers,
        body: JSON.stringify({ messageIds }),
      });
    } else {
      return json({ error: `action inválida: ${action}` }, 400);
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) return json({ error: "Falha na ação", details: data }, res.status);
    return json({ success: true, data });
  } catch (e) {
    console.error("[wasender-message-actions] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
