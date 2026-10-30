import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";
import { classifyActionError, canRetry, supportsGroupAction } from "./policy.ts";

/**
 * group-admin-worker — executa UMA ação administrativa de grupo por instância
 * por ciclo, com ritmo controlado (gaps aleatórios, pausas longas, tetos
 * hora/dia e janela de horário definidos em group_admin_throttle e aplicados
 * pela RPC claim_next_group_admin_action).
 *
 * Roteamento por provedor:
 *  - uazapi   → uazapi-groups (updateName/updateDescription/updateImage/
 *               updateAnnounce/updateMemberAddMode/pinMessage/updateParticipants)
 *  - zapi     → zapi-group-settings (+ zapi-send-group-message para pin)
 *  - wasender → wasender-groups (subconjunto)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LOOP_BUDGET_MS = 50_000;
const PASS_SLEEP_MS = 5_000;

type Action = {
  id: string;
  whatsapp_number_id: string;
  group_db_id: string | null;
  group_jid: string;
  group_name_snapshot: string | null;
  action_type: string;
  payload: Record<string, any>;
  attempts: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!(await isAuthorizedCron(req))) return unauthorizedResponse(corsHeaders);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Configuração indisponível" }, 500);
  const supabase = createClient(url, key);
  const started = Date.now();
  const stats = { done: 0, failed: 0, deferred: 0, skipped: 0 };

  const callFn = async (fn: string, body: Record<string, unknown>) => {
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data?.success !== false && !data?.error;
      return { ok, status: r.status, data, error: ok ? null : (data?.error || `http_${r.status}`) };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: String(e) };
    }
  };

  const executeAction = async (a: Action, provider: string): Promise<{ ok: boolean; status: number; error: string | null; result: any }> => {
    if (!supportsGroupAction(provider, a.action_type)) return { ok: false, status: 400, error: `Ação "${a.action_type}" não suportada pelo provedor ${provider}`, result: { code: "UNSUPPORTED_ACTION" } };
    const p = a.payload || {};
    const jid = a.group_jid;
    const wid = a.whatsapp_number_id;
    let r: { ok: boolean; status: number; data: any; error: string | null };

    if (provider === "uazapi") {
      switch (a.action_type) {
        case "rename": r = await callFn("uazapi-groups", { action: "updateName", groupJid: jid, name: p.name, whatsapp_number_id: wid }); break;
        case "set_description": r = await callFn("uazapi-groups", { action: "updateDescription", groupJid: jid, description: p.description ?? "", whatsapp_number_id: wid }); break;
        case "set_photo": r = await callFn("uazapi-groups", { action: "updateImage", groupJid: jid, image: p.photo_url, whatsapp_number_id: wid }); break;
        case "set_only_admins_send": r = await callFn("uazapi-groups", { action: "updateAnnounce", groupJid: jid, announce: !!p.enabled, whatsapp_number_id: wid }); break;
        case "set_only_admins_add": r = await callFn("uazapi-groups", { action: "updateMemberAddMode", groupJid: jid, adminsOnly: !!p.enabled, whatsapp_number_id: wid }); break;
        case "pin_message": r = await callFn("uazapi-groups", { action: "pinMessage", groupJid: jid, message: p.text, pinDuration: p.duration || "7_days", whatsapp_number_id: wid }); break;
        case "promote_admin": r = await callFn("uazapi-groups", { action: "updateParticipants", groupJid: jid, participantAction: "promote", participants: [p.phone], whatsapp_number_id: wid }); break;
        case "demote_admin": r = await callFn("uazapi-groups", { action: "updateParticipants", groupJid: jid, participantAction: "demote", participants: [p.phone], whatsapp_number_id: wid }); break;
        case "add_participant": r = await callFn("uazapi-groups", { action: "updateParticipants", groupJid: jid, participantAction: "add", participants: [p.phone], whatsapp_number_id: wid }); break;
        case "remove_participant": r = await callFn("uazapi-groups", { action: "updateParticipants", groupJid: jid, participantAction: "remove", participants: [p.phone], whatsapp_number_id: wid }); break;
        default: return { ok: false, status: 400, error: `Ação desconhecida: ${a.action_type}`, result: null };
      }
      return { ok: r.ok, status: r.status, error: r.error, result: r.data };
    }

    if (provider === "wasender") {
      switch (a.action_type) {
        case "set_only_admins_send":
        case "set_only_admins_add":
          r = await callFn("wasender-groups", { action: "settings", groupJid: jid, settings: a.action_type === "set_only_admins_send" ? { announce: !!p.enabled } : { restrict: !!p.enabled }, whatsapp_number_id: wid });
          break;
        case "promote_admin": r = await callFn("wasender-groups", { action: "updateParticipants", groupJid: jid, participantAction: "promote", participants: [p.phone], whatsapp_number_id: wid }); break;
        case "demote_admin": r = await callFn("wasender-groups", { action: "updateParticipants", groupJid: jid, participantAction: "demote", participants: [p.phone], whatsapp_number_id: wid }); break;
        case "add_participant": r = await callFn("wasender-groups", { action: "updateParticipants", groupJid: jid, participantAction: "add", participants: [p.phone], whatsapp_number_id: wid }); break;
        case "remove_participant": r = await callFn("wasender-groups", { action: "updateParticipants", groupJid: jid, participantAction: "remove", participants: [p.phone], whatsapp_number_id: wid }); break;
        default: return { ok: false, status: 400, error: `Ação "${a.action_type}" não suportada pelo provedor WaSender`, result: null };
      }
      return { ok: r.ok, status: r.status, error: r.error, result: r.data };
    }

    // Padrão: Z-API
    switch (a.action_type) {
      case "rename": r = await callFn("zapi-group-settings", { action: "update-name", groupId: jid, value: p.name, whatsapp_number_id: wid }); break;
      case "set_description": r = await callFn("zapi-group-settings", { action: "update-description", groupId: jid, value: p.description ?? "", whatsapp_number_id: wid }); break;
      case "set_photo": r = await callFn("zapi-group-settings", { action: "update-photo", groupId: jid, value: p.photo_url, whatsapp_number_id: wid }); break;
      case "set_only_admins_send": r = await callFn("zapi-group-settings", { action: "set-messages-admins-only", groupId: jid, value: String(!!p.enabled), whatsapp_number_id: wid }); break;
      case "set_only_admins_add": r = await callFn("zapi-group-settings", { action: "set-add-admins-only", groupId: jid, value: String(!!p.enabled), whatsapp_number_id: wid }); break;
      case "promote_admin": r = await callFn("zapi-group-settings", { action: "promote-admin", groupId: jid, phone: p.phone, whatsapp_number_id: wid }); break;
      case "demote_admin": r = await callFn("zapi-group-settings", { action: "demote-admin", groupId: jid, phone: p.phone, whatsapp_number_id: wid }); break;
      case "add_participant": r = await callFn("zapi-group-settings", { action: "add-participant", groupId: jid, phone: p.phone, whatsapp_number_id: wid }); break;
      case "remove_participant": r = await callFn("zapi-group-settings", { action: "remove-participant", groupId: jid, phone: p.phone, whatsapp_number_id: wid }); break;
      case "pin_message": {
        const sent = await callFn("zapi-send-group-message", { groupId: jid, type: "text", message: p.text, whatsapp_number_id: wid });
        const messageId = sent.data?.messageId || sent.data?.data?.messageId || sent.data?.data?.zaapId || null;
        if (!sent.ok || !messageId) return { ok: false, status: sent.status, error: sent.error || "envio sem ID para fixar", result: sent.data };
        r = await callFn("zapi-group-settings", { action: "pin-message", groupId: jid, messageId, pinDuration: p.duration || "7_days", whatsapp_number_id: wid });
        break;
      }
      default: return { ok: false, status: 400, error: `Ação desconhecida: ${a.action_type}`, result: null };
    }
    return { ok: r.ok, status: r.status, error: r.error, result: r.data };
  };

  const finish = async (a: Action, outcome: "done" | "failed" | "retry", info: { error?: string | null; result?: any; instanceFailure?: boolean }) => {
    const { error } = await supabase.rpc("finish_group_admin_action", {
      p_id: a.id, p_outcome: outcome, p_error: info.error ?? null,
      p_result: info.result ?? null, p_instance_failure: info.instanceFailure ?? true,
    });
    if (error) throw error;
  };

  const mirrorToGroupRow = async (a: Action) => {
    if (!a.group_db_id) return;
    const p = a.payload || {};
    const patch: Record<string, any> = {};
    if (a.action_type === "rename") patch.name = p.name;
    if (a.action_type === "set_description") patch.description = p.description ?? null;
    if (a.action_type === "set_photo") patch.photo_url = p.photo_url ?? null;
    if (a.action_type === "set_only_admins_send") patch.only_admins_send = !!p.enabled;
    if (a.action_type === "set_only_admins_add") patch.only_admins_add = !!p.enabled;
    if (Object.keys(patch).length > 0) {
      await supabase.from("whatsapp_groups").update(patch).eq("id", a.group_db_id);
    }
  };

  try {
    const { error: routingError } = await supabase.rpc("refresh_group_admin_send_routes", { p_limit: 200 });
    if (routingError) throw routingError;
    // Resgata ações travadas há mais de 3 min (worker morreu no meio)
    await supabase.from("group_admin_actions")
      .update({ status: "queued", locked_until: null, updated_at: new Date().toISOString() })
      .eq("status", "running")
      .lt("locked_until", new Date().toISOString());

    while (Date.now() - started < LOOP_BUDGET_MS) {
      // Instâncias com ações na fila
      const { data: queuedRows } = await supabase
        .from("group_admin_actions")
        .select("whatsapp_number_id")
        .eq("status", "queued")
        .or(`not_before.is.null,not_before.lte.${new Date().toISOString()}`)
        .limit(200);
      const numberIds = [...new Set((queuedRows || []).map((r: any) => r.whatsapp_number_id))];
      if (numberIds.length === 0) break;

      // Provedor + status online de cada instância
      const { data: numbers } = await supabase
        .from("whatsapp_numbers")
        .select("id, provider, is_online, is_active")
        .in("id", numberIds);
      const numMap = new Map<string, any>((numbers || []).map((n: any) => [n.id, n]));

      let claimedAny = false;
      for (const numberId of numberIds) {
        if (Date.now() - started >= LOOP_BUDGET_MS) break;
        const inst = numMap.get(numberId);
        if (!inst || inst.is_active === false) {
          const { error } = await supabase.from("group_admin_actions").update({ status: "skipped", error_message: "Instância inativa", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("whatsapp_number_id", numberId).eq("status", "queued");
          if (error) throw error;
          stats.skipped++; continue;
        }

        // Instância offline: adia as ações dela em 10 min (sem contar tentativa)
        if (inst.is_online === false) {
          await supabase.from("group_admin_actions")
            .update({ not_before: new Date(Date.now() + 10 * 60_000).toISOString(), updated_at: new Date().toISOString() })
            .eq("whatsapp_number_id", numberId).eq("status", "queued")
            .or("not_before.is.null,not_before.lte." + new Date().toISOString());
          console.log(`[group-admin-worker] instância ${numberId} offline — ações adiadas 10min`);
          stats.deferred++;
          continue;
        }

        const { data: claimed, error: claimError } = await supabase.rpc("claim_next_group_admin_action", { p_number_id: numberId });
        if (claimError) throw claimError;
        const action = (Array.isArray(claimed) ? claimed[0] : claimed) as Action | null;
        if (!action) continue; // throttle segurou (gap, janela, tetos) ou fila vazia
        claimedAny = true;

        // Pin deferral happens atomically inside claim, before attempts and throttle.
        const provider = inst.provider || "zapi";
        console.log(`[group-admin-worker] executando ${action.action_type} no grupo ${action.group_jid} (${provider}, tentativa ${action.attempts})`);
        const r = await executeAction(action, provider);

        if (r.ok) {
          await mirrorToGroupRow(action);
          await finish(action, "done", { result: r.result });
          stats.done++;
          console.log(`[group-admin-worker] ${action.action_type} OK no grupo ${action.group_jid}`);
        } else {
          const errText = String(r.error || "");
          const classification = classifyActionError(r.status, r.result, errText);
          if (classification.permanent) {
            await finish(action, "failed", { error: classification.message, result: r.result, instanceFailure: false });
            stats.failed++;
          } else if (canRetry(action.attempts)) {
            await finish(action, "retry", { error: errText });
            console.warn(`[group-admin-worker] ${action.action_type} falhou (tentativa ${action.attempts}), nova tentativa em 10min: ${errText}`);
          } else {
            await finish(action, "failed", { error: errText.slice(0, 300) });
            stats.failed++;
            console.error(`[group-admin-worker] ${action.action_type} FALHOU de vez no grupo ${action.group_jid}: ${errText}`);
          }
        }
      }

      if (!claimedAny) break; // nada liberado pelo throttle neste passe
      await new Promise((r) => setTimeout(r, PASS_SLEEP_MS));
    }

    console.log(`[group-admin-worker] fim do ciclo:`, stats);
    return json({ success: true, ...stats });
  } catch (e) {
    console.error("[group-admin-worker] erro geral:", e);
    return json({ error: "Internal server error", details: (e as Error).message }, 500);
  }
});
