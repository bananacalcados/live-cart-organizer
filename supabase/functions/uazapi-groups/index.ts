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
      case "updateName": {
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        if (!body.name) return json({ error: "name obrigatório" }, 400);
        r = await uazapiInstance("/group/updateName", token, {
          method: "POST",
          body: { groupjid: jid, name: String(body.name) },
        });
        break;
      }
      case "updateDescription": {
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await uazapiInstance("/group/updateDescription", token, {
          method: "POST",
          body: { groupjid: jid, description: String(body.description ?? "") },
        });
        break;
      }
      case "updateImage": {
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        if (!body.image) return json({ error: "image obrigatório" }, 400);
        r = await uazapiInstance("/group/updateImage", token, {
          method: "POST",
          body: { groupjid: jid, image: String(body.image) },
        });
        break;
      }
      case "updateAnnounce": {
        // announce=true → apenas admins enviam mensagens
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await uazapiInstance("/group/updateAnnounce", token, {
          method: "POST",
          body: { groupjid: jid, announce: Boolean(body.announce) },
        });
        break;
      }
      case "updateMemberAddMode": {
        // adminsOnly=true → apenas admins adicionam membros
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        r = await uazapiInstance("/group/updateMemberAddMode", token, {
          method: "POST",
          body: { groupjid: jid, MemberAddMode: body.adminsOnly ? "admin_add" : "all_member_add" },
        });
        break;
      }
      case "pinMessage": {
        // Envia o texto no grupo e fixa a mensagem enviada.
        if (!jid) return json({ error: "groupJid obrigatório" }, 400);
        if (!body.message) return json({ error: "message obrigatório" }, 400);
        const sent = await uazapiInstance("/send/text", token, {
          method: "POST",
          body: { number: jid, text: String(body.message) },
        });
        if (!sent.ok) {
          return json({ error: "Falha ao enviar mensagem para fixar", details: sent.data }, sent.status);
        }
        const messageId =
          sent.data?.messageid || sent.data?.id ||
          sent.data?.message?.messageid || sent.data?.message?.id || null;
        if (!messageId) {
          return json({ error: "Mensagem enviada mas sem ID para fixar", details: sent.data }, 502);
        }
        const durationMap: Record<string, number> = { "24_hours": 1, "7_days": 7, "30_days": 30 };
        const duration = durationMap[String(body.pinDuration || "7_days")] ?? 7;
        await new Promise((res) => setTimeout(res, 1500));
        r = await uazapiInstance("/message/pin", token, {
          method: "POST",
          body: { id: messageId, pin: true, duration },
        });
        break;
      }
      case "dddStats": {
        // Analisa quantos participantes de cada grupo têm DDD 33 (Gov. Valadares/MG).
        // Lê os grupos da instância no banco, busca participantes via /group/info e
        // grava ddd33_count / ddd33_total_resolved / ddd33_synced_at em whatsapp_groups.
        const instanceId = String(body.whatsapp_number_id || "");
        if (!instanceId) return json({ error: "whatsapp_number_id obrigatório" }, 400);

        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        let query = supabase
          .from("whatsapp_groups")
          .select("id, group_id, name")
          .eq("instance_id", instanceId);
        if (Array.isArray(body.groupIds) && body.groupIds.length > 0) {
          query = query.in("id", body.groupIds);
        }
        const { data: dbGroups, error: dbErr } = await query;
        if (dbErr) return json({ error: dbErr.message }, 500);

        const startedAt = Date.now();
        const TIME_BUDGET_MS = 110_000;
        const results: any[] = [];
        let processed = 0;

        const phoneFromParticipant = (p: any): string | null => {
          const candidates = [p?.phone, p?.PhoneNumber, p?.phoneNumber, p?.number];
          for (const c of candidates) {
            const d = String(c || "").replace(/\D/g, "");
            if (d.length >= 12 && d.length <= 13 && d.startsWith("55")) return d;
          }
          const jidRaw = String(p?.JID || p?.jid || p?.id || p?.remoteJid || "");
          if (jidRaw.includes("@s.whatsapp.net") || jidRaw.includes("@c.us")) {
            const d = jidRaw.replace(/\D/g, "");
            if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
            if ((d.length === 10 || d.length === 11)) return "55" + d;
          }
          return null;
        };

        for (const g of dbGroups || []) {
          if (Date.now() - startedAt > TIME_BUDGET_MS) break;
          const gjid = groupJid(String(g.group_id));
          const info = await uazapiInstance("/group/info", token, {
            method: "POST",
            body: { groupjid: gjid },
          });
          if (!info.ok) {
            results.push({ id: g.id, name: g.name, error: true });
            continue;
          }
          const raw = info.data;
          const participants: any[] = Array.isArray(raw?.Participants)
            ? raw.Participants
            : Array.isArray(raw?.participants)
              ? raw.participants
              : Array.isArray(raw?.group?.participants)
                ? raw.group.participants
                : Array.isArray(raw?.data?.participants)
                  ? raw.data.participants
                  : [];

          let ddd33 = 0;
          let resolved = 0;
          for (const p of participants) {
            const phone = phoneFromParticipant(p);
            if (!phone) continue;
            resolved++;
            if (phone.substring(2, 4) === "33") ddd33++;
          }

          await supabase
            .from("whatsapp_groups")
            .update({
              ddd33_count: ddd33,
              ddd33_total_resolved: resolved,
              ddd33_synced_at: new Date().toISOString(),
              participant_count: participants.length || undefined,
            })
            .eq("id", g.id);

          results.push({ id: g.id, name: g.name, ddd33_count: ddd33, total_resolved: resolved, participants: participants.length });
          processed++;
          await new Promise((res) => setTimeout(res, 250));
        }

        return json({
          success: true,
          processed,
          total: (dbGroups || []).length,
          remaining: Math.max(0, (dbGroups || []).length - processed),
          results,
        });
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
