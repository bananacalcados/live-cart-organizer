import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
 * wasender-groups — gestão de grupos WhatsApp via WaSender (usa a api_key da sessão).
 *
 * Body.action:
 *  - list                → lista todos os grupos
 *  - metadata            → { groupJid }
 *  - participants        → { groupJid }  (lista)
 *  - addParticipants     → { groupJid, participants: string[] }
 *  - removeParticipants  → { groupJid, participants: string[] }
 *  - updateParticipants  → { groupJid, participants: string[], action: 'promote'|'demote' }
 *  - settings            → { groupJid, settings: {...} }
 *  - picture             → { groupJid }
 *  - inviteLink          → { groupJid }
 *  - create              → { name, participants: string[] }
 *  - leave               → { groupJid }
 *  - sendMessage         → { groupJid, message, mentions?: string[] }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = String(body.action || "");
    const { apiKey } = await resolveWasenderCredentials(body.whatsapp_number_id);
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    const call = async (path: string, method = "GET", payload?: unknown) => {
      const res = await fetch(`${WASENDER_BASE}${path}`, {
        method,
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    };

    const jid = body.groupJid as string | undefined;
    let r: { ok: boolean; status: number; data: any };

    switch (action) {
      case "list":
        r = await call(`/groups`);
        break;
      case "metadata":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await call(`/groups/${jid}/metadata`);
        break;
      case "participants":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await call(`/groups/${jid}/participants`);
        break;
      case "addParticipants":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await call(`/groups/${jid}/participants/add`, "POST", { participants: body.participants });
        break;
      case "removeParticipants":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await call(`/groups/${jid}/participants/remove`, "POST", { participants: body.participants });
        break;
      case "updateParticipants":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await call(`/groups/${jid}/participants/update`, "PUT", {
          participants: body.participants,
          action: body.participantAction || "promote",
        });
        break;
      case "settings":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await call(`/groups/${jid}/settings`, "PUT", body.settings || {});
        break;
      case "picture":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await call(`/groups/${jid}/picture`);
        break;
      case "inviteLink":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await call(`/groups/${jid}/invite-link`);
        break;
      case "create":
        r = await call(`/groups`, "POST", { name: body.name, participants: body.participants });
        break;
      case "leave":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await call(`/groups/${jid}/leave`, "POST");
        break;
      case "sendMessage": {
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        const payload: Record<string, unknown> = { to: jid, text: body.message };
        if (Array.isArray(body.mentions) && body.mentions.length > 0) {
          payload.mentions = body.mentions;
        }
        r = await call(`/send-message`, "POST", payload);
        break;
      }
      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }

    if (!r.ok) return json({ error: "Falha na operação de grupo", details: r.data }, r.status);
    return json({ success: true, data: r.data });
  } catch (e) {
    console.error("[wasender-groups] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
