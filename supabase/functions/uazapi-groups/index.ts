import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

/** Normaliza o JID de grupo para o formato `<digits>@g.us` aceito pela uazapi. */
function groupJid(raw: string): string {
  if (!raw) return raw;
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  return `${digits}@g.us`;
}

/**
 * uazapi-groups — gestão de grupos WhatsApp via uazapi (usa o Instance Token).
 *
 * Body.action:
 *  - list                → lista todos os grupos (opcional syncToDb)
 *  - info                → { groupJid }
 *  - inviteLink          → { groupJid }
 *  - create              → { name, participants: string[] }
 *  - leave               → { groupJid }
 *  - updateParticipants  → { groupJid, participants: string[], participantAction: 'add'|'remove'|'promote'|'demote' }
 *  - sendMessage         → { groupJid, message, mentions?: string[] }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = String(body.action || "");
    const { token } = await resolveUazapiCredentials(body.whatsapp_number_id);

    const jid = body.groupJid ? groupJid(String(body.groupJid)) : undefined;
    let r: { ok: boolean; status: number; data: any };

    switch (action) {
      case "list": {
        r = await uazapiInstance("/group/list", token, { method: "GET" });
        if (r.ok && body.syncToDb) {
          try {
            const raw = r.data;
            const list: any[] = Array.isArray(raw?.groups)
              ? raw.groups
              : Array.isArray(raw?.data)
                ? raw.data
                : Array.isArray(raw)
                  ? raw
                  : [];
            const instanceId = String(body.whatsapp_number_id || "uazapi");
            const rows = list
              .map((g: any) => {
                const groupId = g.jid || g.JID || g.id || g.groupId || g.remoteJid;
                if (!groupId) return null;
                const participants = Array.isArray(g.Participants)
                  ? g.Participants.length
                  : Array.isArray(g.participants)
                    ? g.participants.length
                    : (g.ParticipantCount ?? g.participantCount ?? g.size ?? 0);
                return {
                  group_id: String(groupId),
                  name: g.Name || g.name || g.subject || "Sem nome",
                  description: g.Description || g.description || g.desc || null,
                  photo_url: g.ProfilePicUrl || g.profilePicUrl || g.imgUrl || g.pictureUrl || null,
                  participant_count: participants,
                  is_admin: Boolean(g.IsAdmin ?? g.isAdmin ?? g.imAdmin),
                  instance_id: instanceId,
                  last_synced_at: new Date().toISOString(),
                };
              })
              .filter(Boolean) as any[];

            if (rows.length > 0) {
              const supabase = createClient(
                Deno.env.get("SUPABASE_URL")!,
                Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
              );
              const { error } = await supabase
                .from("whatsapp_groups")
                .upsert(rows, { onConflict: "group_id,instance_id", ignoreDuplicates: false });
              if (error) console.error("[uazapi-groups] sync error:", error.message);
              else console.log(`[uazapi-groups] synced ${rows.length} groups`);
              return json({ success: true, data: r.data, total: rows.length });
            }
            return json({ success: true, data: r.data, total: 0 });
          } catch (e) {
            console.error("[uazapi-groups] syncToDb falhou:", (e as Error).message);
          }
        }
        break;
      }
      case "info":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await uazapiInstance("/group/info", token, { method: "POST", body: { groupjid: jid } });
        break;
      case "inviteLink":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await uazapiInstance("/group/invitelink", token, { method: "POST", body: { groupjid: jid } });
        break;
      case "create":
        r = await uazapiInstance("/group/create", token, {
          method: "POST",
          body: {
            name: body.name,
            participants: (body.participants || []).map((p: string) => formatUazapiNumber(p)),
          },
        });
        break;
      case "leave":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await uazapiInstance("/group/leave", token, { method: "POST", body: { groupjid: jid } });
        break;
      case "updateParticipants":
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await uazapiInstance("/group/updateParticipants", token, {
          method: "POST",
          body: {
            groupjid: jid,
            action: body.participantAction || "add",
            participants: (body.participants || []).map((p: string) => formatUazapiNumber(p)),
          },
        });
        break;
      case "sendMessage": {
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        const payload: Record<string, unknown> = { number: jid, text: body.message };
        if (Array.isArray(body.mentions) && body.mentions.length > 0) {
          payload.mentions = body.mentions.map((m: string) => formatUazapiNumber(m));
        }
        r = await uazapiInstance("/send/text", token, { method: "POST", body: payload });
        break;
      }
      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }

    if (!r.ok) return json({ error: "Falha na operação de grupo", details: r.data }, r.status);
    return json({ success: true, data: r.data });
  } catch (e) {
    console.error("[uazapi-groups] error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
