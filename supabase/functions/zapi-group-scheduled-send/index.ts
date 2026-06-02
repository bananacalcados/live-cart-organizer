// PLANNER de campanhas para Grupos VIPs (Fila Durável com Delay Agendado)
// ------------------------------------------------------------------------
// Este endpoint NÃO envia mensagens diretamente. Ele apenas:
//  1) Faz o "claim" atômico da mensagem agendada (evita disparo duplicado)
//  2) Valida pausa global, instância online e grupos
//  3) PLANEJA todos os jobs (grupo × bloco) na tabela
//     group_campaign_block_dispatches com:
//       - seq            → ordem absoluta do disparo
//       - delay_after_ms → atraso VARIÁVEL/humanizado a aplicar APÓS o job
//       - send_after     → quando o job fica liberado (1º = agora, demais = null)
//  4) Dispara o worker uma vez (start imediato)
//
// O envio real + o ritmo (delays) é feito pelo `group-dispatch-worker`, que é
// reentrante e imune ao timeout de Edge Functions: o estado vive no banco.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPausedGroupSendUntil } from "../_shared/group-send-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ===== Defaults humanizados (delays VARIÁVEIS sorteados por job) =====
const INTER_BLOCK_DELAY_MIN_MS = 4_000;
const INTER_BLOCK_DELAY_MAX_MS = 8_000;
const INTER_GROUP_DELAY_MIN_MS = 12_000;
const INTER_GROUP_DELAY_MAX_MS = 25_000;
const LONG_PAUSE_EVERY_N_GROUPS = 5;
const LONG_PAUSE_MIN_MS = 40_000;
const LONG_PAUSE_MAX_MS = 70_000;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { scheduledMessageId } = await req.json();
    if (!scheduledMessageId) {
      return new Response(JSON.stringify({ error: "scheduledMessageId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingMsg } = await supabase
      .from("group_campaign_scheduled_messages")
      .select("id, status, locked_until, message_group_id")
      .eq("id", scheduledMessageId)
      .maybeSingle();

    if (!existingMsg) {
      return new Response(JSON.stringify({ error: "Scheduled message not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== Pausa global =====
    const pausedBeforeStart = await getPausedGroupSendUntil(supabase);
    if (pausedBeforeStart) {
      const col = existingMsg.message_group_id ? "message_group_id" : "id";
      const val = existingMsg.message_group_id || scheduledMessageId;
      await supabase.from("group_campaign_scheduled_messages")
        .update({ status: "cancelled" })
        .eq(col, val)
        .in("status", ["pending", "sending"]);
      return new Response(
        JSON.stringify({ error: "Group sends temporarily paused", pausedUntil: pausedBeforeStart }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ===== Claim atômico (impede planejamento duplicado) =====
    const { data: claimResult, error: claimErr } = await supabase.rpc("try_claim_scheduled_message", {
      p_message_id: scheduledMessageId,
      p_lock_duration_seconds: 120,
    });
    if (claimErr) {
      return new Response(JSON.stringify({ error: "claim_failed", details: claimErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const claimedMsg = claimResult && claimResult.length > 0 ? claimResult[0] : null;
    if (!claimedMsg) {
      return new Response(
        JSON.stringify({ error: "already_processed_or_locked", status: existingMsg.status }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lockUntil = new Date(Date.now() + 120_000).toISOString();

    // Marca irmãos (mesmo message_group_id) como sending
    if (claimedMsg.message_group_id) {
      await supabase.from("group_campaign_scheduled_messages")
        .update({ status: "sending", locked_until: lockUntil })
        .eq("message_group_id", claimedMsg.message_group_id)
        .in("status", ["pending", "grouped"]);
    }

    // Carrega mensagem + campanha
    const { data: msg } = await supabase
      .from("group_campaign_scheduled_messages")
      .select("*, group_campaigns!inner(id, target_groups, whatsapp_number_id)")
      .eq("id", scheduledMessageId)
      .single();

    if (!msg) {
      return new Response(JSON.stringify({ error: "msg_not_found_after_claim" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const campaign = msg.group_campaigns;
    const campaignId = campaign.id;
    const targetGroupIds: string[] = campaign.target_groups || [];
    const resolvedNumberId = msg.whatsapp_number_id || campaign.whatsapp_number_id || null;
    const messageGroupId = msg.message_group_id;

    // ===== Valida instância online (apenas zapi tem flag confiável) =====
    if (resolvedNumberId) {
      const { data: inst } = await supabase
        .from("whatsapp_numbers")
        .select("id, label, is_online, provider")
        .eq("id", resolvedNumberId)
        .maybeSingle();

      if (inst && inst.provider === "zapi" && inst.is_online === false) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/zapi-instance-health-check`, {
            method: "POST",
            headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ instanceId: resolvedNumberId }),
          });
        } catch { /* ignore */ }
        const { data: instFresh } = await supabase
          .from("whatsapp_numbers")
          .select("is_online")
          .eq("id", resolvedNumberId)
          .maybeSingle();
        if (instFresh?.is_online === false) {
          const errMsg = `Instância ${inst.label} está desconectada.`;
          await supabase.from("group_campaign_scheduled_messages")
            .update({ status: "failed", failed_reason: errMsg, locked_until: null })
            .eq(messageGroupId ? "message_group_id" : "id", messageGroupId || scheduledMessageId);
          return new Response(JSON.stringify({ error: "instance_offline", instanceLabel: inst.label }), {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // ===== Grupos =====
    const { data: allGroups } = await supabase
      .from("whatsapp_groups")
      .select("id, group_id, name")
      .in("id", targetGroupIds);

    if (!allGroups || allGroups.length === 0) {
      await supabase.from("group_campaign_scheduled_messages")
        .update({ status: "failed" })
        .eq("id", scheduledMessageId);
      return new Response(JSON.stringify({ error: "no_valid_groups" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const alreadySentGroupIds: string[] = msg.sent_group_ids || [];
    const pendingGroups = allGroups.filter((g) => !alreadySentGroupIds.includes(g.id));
    if (pendingGroups.length === 0) {
      await supabase.from("group_campaign_scheduled_messages")
        .update({ status: "sent", sent_at: new Date().toISOString(), locked_until: null })
        .eq("id", scheduledMessageId);
      return new Response(JSON.stringify({ success: true, complete: true, totalGroups: allGroups.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== Blocos (ordenados) deste message-group =====
    let allBlocks: any[] = [msg];
    if (messageGroupId) {
      const { data: grouped } = await supabase
        .from("group_campaign_scheduled_messages")
        .select("*")
        .eq("message_group_id", messageGroupId)
        .order("block_order", { ascending: true });
      if (grouped && grouped.length > 0) allBlocks = grouped;
    }

    // ===== Idempotência: já existe fila para este disparo? =====
    const dispatchCol = messageGroupId ? "message_group_id" : "scheduled_message_id";
    const dispatchVal = messageGroupId || scheduledMessageId;
    const { count: existingJobs } = await supabase
      .from("group_campaign_block_dispatches")
      .select("id", { count: "exact", head: true })
      .eq(dispatchCol, dispatchVal)
      .not("seq", "is", null);

    if (!existingJobs || existingJobs === 0) {
      // ===== PLANEJAMENTO: monta todos os jobs com delays VARIÁVEIS =====
      const nowIso = new Date().toISOString();
      const jobs: any[] = [];
      let seq = 0;
      for (let gi = 0; gi < pendingGroups.length; gi++) {
        const group = pendingGroups[gi];
        const isLastGroup = gi === pendingGroups.length - 1;
        const groupNum = gi + 1; // cadência de pausa longa

        for (let bi = 0; bi < allBlocks.length; bi++) {
          const block = allBlocks[bi];
          const isLastBlock = bi === allBlocks.length - 1;
          seq++;

          let delayAfter: number;
          if (!isLastBlock) {
            // entre blocos do mesmo grupo
            delayAfter = Math.round(rand(INTER_BLOCK_DELAY_MIN_MS, INTER_BLOCK_DELAY_MAX_MS));
          } else if (!isLastGroup) {
            // transição de grupo (pausa longa periódica)
            const isLongPause = groupNum % LONG_PAUSE_EVERY_N_GROUPS === 0;
            delayAfter = Math.round(
              isLongPause
                ? rand(LONG_PAUSE_MIN_MS, LONG_PAUSE_MAX_MS)
                : rand(INTER_GROUP_DELAY_MIN_MS, INTER_GROUP_DELAY_MAX_MS),
            );
          } else {
            // último job do disparo
            delayAfter = 0;
          }

          jobs.push({
            scheduled_message_id: scheduledMessageId,
            message_group_id: messageGroupId || null,
            campaign_id: campaignId,
            group_db_id: group.id,
            group_zapi_id: group.group_id,
            group_name: group.name,
            block_order: block.block_order ?? bi,
            block_type: block.message_type || "text",
            whatsapp_number_id: resolvedNumberId,
            seq,
            delay_after_ms: delayAfter,
            send_after: seq === 1 ? nowIso : null, // só o 1º já está liberado
            status: "pending",
            attempts: 0,
          });
        }
      }

      const { error: insertErr } = await supabase
        .from("group_campaign_block_dispatches")
        .insert(jobs);

      if (insertErr) {
        await supabase.from("group_campaign_scheduled_messages")
          .update({ status: "failed", failed_reason: `plan_failed: ${insertErr.message}`.slice(0, 500), locked_until: null })
          .eq(messageGroupId ? "message_group_id" : "id", messageGroupId || scheduledMessageId);
        return new Response(JSON.stringify({ error: "plan_failed", details: insertErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Mantém a(s) mensagem(ns) como "sending" (o worker conclui para "sent")
    await supabase.from("group_campaign_scheduled_messages")
      .update({ status: "sending", locked_until: lockUntil })
      .eq(messageGroupId ? "message_group_id" : "id", messageGroupId || scheduledMessageId);

    // ===== Start imediato: dispara o worker (fire-and-forget) =====
    try {
      fetch(`${supabaseUrl}/functions/v1/group-dispatch-worker`, {
        method: "POST",
        headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "planner", numberId: resolvedNumberId }),
      }).catch(() => {});
    } catch { /* ignore */ }

    return new Response(
      JSON.stringify({
        success: true,
        planned: true,
        processed: 0,
        complete: false,
        totalGroups: allGroups.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "internal", details: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
