import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isLikelyGroupId } from "./group-send-guard.ts";
import { requireUser } from "./require-user.ts";
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

export interface GroupSendRoute {
  base: string; instance_id: string | null; label: string | null; provider: string;
  online: boolean; present: boolean; is_admin: boolean; group_db_id: string | null;
  group_jid: string; source: string; target_id: string; name: string;
  responsible_id: string | null; responsible_label: string | null; lease_id?: string;
}

export async function resolveGroupRoutes(client: any, ids: string[], fallback: string | null, overrides: Record<string, string> = {}): Promise<GroupSendRoute[]> {
  const routes: GroupSendRoute[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await client.rpc("group_send_routes", { p_group_ids: ids.slice(offset, offset + 200), p_fallback: fallback, p_overrides: overrides });
    if (error) throw error;
    routes.push(...(data || []));
  }
  return [...new Map(routes.map(route => [route.base, route])).values()];
}

/** Direct sends preserve explicit choices; reservations prevent a concurrent responsible swap. */
export async function beginDirectGroupSend(phone: string, explicit?: string | null): Promise<GroupSendRoute | null> {
  if (!isLikelyGroupId(phone)) return null;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Configuração indisponível");
  const client = createClient(url, key);
  const { data, error } = await client.rpc("reserve_direct_group_send", { p_jid: phone, p_fallback: explicit || null, p_override: explicit || null });
  if (error) throw error;
  return data as GroupSendRoute;
}

export async function finishDirectGroupSend(route: GroupSendRoute | null, outcome: string, messageId?: string | null) {
  if (!route?.lease_id) return;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  const { error } = await createClient(url, key).rpc("finish_direct_group_send", { p_id: route.lease_id, p_outcome: outcome, p_message_id: messageId || null });
  if (error) console.error("group send history persistence failed", error.message);
}

/** Wrap provider endpoints without changing message content or private-contact flows. */
export function withGroupSendRouting(provider: string, kind: string, handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return handler(req);
    let route: GroupSendRoute | null = null;
    let dispatched = false;
    try {
      const body = await req.clone().json();
      const phone = body.phone || body.groupId || body.groupJid;
      if (typeof phone !== "string" || !isLikelyGroupId(phone) || (kind === "groups" && body.action !== "sendMessage")) return handler(req);
      const auth = await requireUser(req);
      if (!auth.ok) return auth.response;
      route = await beginDirectGroupSend(phone, body.whatsapp_number_id);
      if (!route?.instance_id) throw new Error("Instância indisponível");
      const rewritten = { ...body, whatsapp_number_id: route.instance_id };
      if (body.phone) rewritten.phone = route.group_jid;
      if (body.groupId) rewritten.groupId = route.group_jid;
      if (body.groupJid) rewritten.groupJid = route.group_jid;
      let response: Response;
      if (route.provider !== provider) {
        let target = kind === "groups" ? `${route.provider}-groups` : kind === "group" ? `${route.provider}-send-${body.type === 'text' || !body.type ? 'message' : body.type === 'poll' ? 'extra' : 'media'}` : `${route.provider}-send-${kind}`;
        if (!["uazapi", "wasender", "zapi"].includes(route.provider)) throw new Error("Instância não suporta envio para grupo");
        if (route.provider === "zapi") {
          target = "zapi-send-group-message";
          rewritten.groupId = route.group_jid;
          rewritten.type = kind === "media" ? body.mediaType : body.kind === "poll" ? "poll" : "text";
          if (kind === "extra" && body.kind !== "poll") throw new Error("Esse formato não é suportado pela instância responsável");
          if (body.poll) {
            rewritten.message = body.poll.question || body.poll.name;
            rewritten.pollOptions = body.poll.options;
            rewritten.pollMaxOptions = body.poll.selectableCount;
          }
          rewritten.mentionAll = body.mentionAll || false;
        }
        if (kind === "group") {
          rewritten.phone = route.group_jid;
          if (body.type === "poll") { rewritten.kind = "poll"; rewritten.poll = { question: body.message, name: body.message, options: body.pollOptions, selectableCount: body.pollMaxOptions }; }
          else if (body.mediaUrl) { rewritten.mediaType = body.type; }
          else if (body.mentionAll) { target = `${route.provider}-groups`; rewritten.action = "sendMessage"; rewritten.groupJid = route.group_jid; }
        }
        if (kind === "extra" && body.poll) rewritten.poll = { ...body.poll, name: body.poll.name || body.poll.question, question: body.poll.question || body.poll.name };
        const url = Deno.env.get("SUPABASE_URL");
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!url || !key) throw new Error("Configuração indisponível");
        dispatched = true;
        response = await fetch(`${url}/functions/v1/${target}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(rewritten) });
      } else {
        dispatched = true;
        response = await handler(new Request(req.url, { method: req.method, headers: req.headers, body: JSON.stringify(rewritten) }));
      }
      const result = await response.clone().json().catch(() => ({}));
      const messageId = result.messageId || result.data?.messageid || result.data?.id || result.data?.data?.msgId || null;
      const uncertain = response.status >= 500 || (response.ok && !messageId && result.success !== true);
      await finishDirectGroupSend(route, uncertain ? "uncertain" : response.ok && result.success !== false && !result.error ? "sent" : "failed", messageId);
      if (response.headers.get("content-type")?.includes("json")) {
        return new Response(JSON.stringify({ ...result, uncertain, whatsapp_number_id: route.instance_id, instance_label: route.label, messageId }), { status: response.status, headers: response.headers });
      }
      return response;
    } catch (error) {
      await finishDirectGroupSend(route, dispatched ? "uncertain" : "failed");
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Falha no envio para grupo", uncertain: dispatched }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  };
}