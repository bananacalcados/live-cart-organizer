// Envia campanhas para Grupos VIPs em modo "humano real":
// - Sequencial puro (1 mensagem por vez para a Meta/Z-API)
// - Para cada grupo: envia bloco 1, delay, bloco 2, delay... até terminar todos os blocos
// - Em seguida vai pro próximo grupo (delay maior entre grupos)
// - Pausa longa a cada 3 grupos completos
// - Se um bloco falha: 1 retry após 10s. Se falhar de novo, marca como failed e segue
// - Persiste cada (grupo,bloco) em group_campaign_block_dispatches para reenvio seletivo
// - Aborta se instância Z-API estiver offline (is_online=false)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPausedGroupSendUntil } from "../_shared/group-send-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ===== Defaults humanizados (reduzidos: mais leves p/ o sistema, sem travar) =====
const INTER_BLOCK_DELAY_MIN_MS = 4_000;
const INTER_BLOCK_DELAY_MAX_MS = 8_000;
const INTER_GROUP_DELAY_MIN_MS = 12_000;
const INTER_GROUP_DELAY_MAX_MS = 25_000;
const LONG_PAUSE_EVERY_N_GROUPS = 5;
const LONG_PAUSE_MIN_MS = 40_000;
const LONG_PAUSE_MAX_MS = 70_000;
const RETRY_DELAY_MS = 10_000;

// Tempo máximo de execução por invocação (cron volta a chamar depois)
const MAX_FUNCTION_TIME_MS = 50_000;
const TIME_GUARD_MS = 10_000;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    const pausedBeforeStart = await getPausedGroupSendUntil(supabase);
    if (pausedBeforeStart) {
      if (existingMsg.message_group_id) {
        await supabase.from("group_campaign_scheduled_messages")
          .update({ status: "cancelled" })
          .eq("message_group_id", existingMsg.message_group_id)
          .in("status", ["pending", "sending"]);
      } else {
        await supabase.from("group_campaign_scheduled_messages")
          .update({ status: "cancelled" })
          .eq("id", scheduledMessageId)
          .in("status", ["pending", "sending"]);
      }
      return new Response(
        JSON.stringify({ error: "Group sends temporarily paused", pausedUntil: pausedBeforeStart }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Atomic claim
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

    const functionStartTime = Date.now();
    const lockUntil = new Date(Date.now() + 120_000).toISOString();

    // Mark sibling blocks (same message_group_id) as sending
    if (claimedMsg.message_group_id) {
      await supabase.from("group_campaign_scheduled_messages")
        .update({ status: "sending", locked_until: lockUntil })
        .eq("message_group_id", claimedMsg.message_group_id)
        .in("status", ["pending", "grouped"]);
    }

    // Fetch the message + campaign
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

    // Provider da instância (zapi | wasender). Default zapi para compatibilidade.
    let instanceProvider = "zapi";

    // ===== Validate instance is online =====
    if (resolvedNumberId) {
      const { data: inst } = await supabase
        .from("whatsapp_numbers")
        .select("id, label, is_online, provider")
        .eq("id", resolvedNumberId)
        .maybeSingle();

      if (inst?.provider) instanceProvider = inst.provider;

      if (inst && inst.provider === "zapi" && inst.is_online === false) {
        // Trigger immediate re-check to avoid stale data
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

    // Campaign vars
    const { data: varsData } = await supabase
      .from("campaign_variables")
      .select("variable_name, variable_value")
      .eq("campaign_id", campaignId);
    const campaignVars: Record<string, string> = {};
    if (varsData) for (const v of varsData) campaignVars[v.variable_name] = v.variable_value;
    const now = new Date();
    campaignVars["data_hoje"] = now.toLocaleDateString("pt-BR");
    campaignVars["horario"] = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

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
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          locked_until: null,
        })
        .eq("id", scheduledMessageId);
      return new Response(JSON.stringify({ success: true, complete: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load all blocks (ordered) for this message-group
    let allBlocks: any[] = [msg];
    if (messageGroupId) {
      const { data: grouped } = await supabase
        .from("group_campaign_scheduled_messages")
        .select("*")
        .eq("message_group_id", messageGroupId)
        .order("block_order", { ascending: true });
      if (grouped && grouped.length > 0) allBlocks = grouped;
    }

    const replaceVars = (text: string, groupName: string): string => {
      let result = text || "";
      for (const [k, v] of Object.entries(campaignVars)) {
        result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
      }
      return result.replace(/\{\{nome_grupo\}\}/g, groupName);
    };

    // Helper genérico de invocação de função → normaliza para { ok, error }
    async function callFn(fnName: string, body: Record<string, unknown>) {
      const r = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data?.success !== false && !data?.error;
      return { ok, error: ok ? null : (data?.error || data?.data?.error || `http_${r.status}`) };
    }

    // Envia um único bloco a um grupo via WaSender (texto/mídia/enquete)
    async function sendBlockWasender(block: any, group: { id: string; group_id: string; name: string }) {
      const content = replaceVars(block.message_content || "", group.name);

      // Enquete
      if (block.message_type === "poll" && Array.isArray(block.poll_options) && block.poll_options.length >= 2) {
        return callFn("wasender-send-extra", {
          kind: "poll",
          phone: group.group_id,
          whatsapp_number_id: resolvedNumberId,
          poll: {
            name: content || "Enquete",
            options: block.poll_options,
            selectableCount: block.poll_max_options && block.poll_max_options > 0 ? block.poll_max_options : 1,
          },
        });
      }

      // Mídia (image | video | audio | document | sticker)
      if (block.message_type !== "text" && block.media_url) {
        return callFn("wasender-send-media", {
          phone: group.group_id,
          mediaUrl: block.media_url,
          mediaType: block.message_type,
          caption: content,
          whatsapp_number_id: resolvedNumberId,
        });
      }

      // Texto (com menções "todos" via wasender-groups quando aplicável)
      if (block.mention_all) {
        return callFn("wasender-groups", {
          action: "sendMessage",
          groupJid: group.group_id,
          message: content,
          whatsapp_number_id: resolvedNumberId,
        });
      }
      return callFn("wasender-send-message", {
        phone: group.group_id,
        message: content,
        whatsapp_number_id: resolvedNumberId,
      });
    }

    // Helper: send a single block, with 1 retry on failure
    async function sendBlockOnce(block: any, group: { id: string; group_id: string; name: string }) {
      // Roteamento por provider da instância
      if (instanceProvider === "wasender") {
        return sendBlockWasender(block, group);
      }

      // ===== Z-API (comportamento original) =====
      const body: Record<string, unknown> = {
        groupId: group.group_id,
        mentionAll: block.mention_all || false,
        whatsapp_number_id: resolvedNumberId,
      };
      const content = replaceVars(block.message_content || "", group.name);
      if (block.message_type === "poll" && block.poll_options) {
        body.type = "poll";
        body.pollOptions = block.poll_options;
        body.message = content;
        body.pollMaxOptions = block.poll_max_options ?? 1;
      } else if (block.message_type !== "text" && block.media_url) {
        body.type = block.message_type;
        body.mediaUrl = block.media_url;
        body.caption = content;
        body.message = content;
      } else {
        body.type = "text";
        body.message = content;
      }
      return callFn("zapi-send-group-message", body);
    }

    async function sendBlockWithRetry(block: any, group: { id: string; group_id: string; name: string }) {
      // Record/upsert tracking row
      const trackingRow = {
        scheduled_message_id: scheduledMessageId,
        message_group_id: messageGroupId || null,
        campaign_id: campaignId,
        group_db_id: group.id,
        group_zapi_id: group.group_id,
        group_name: group.name,
        block_order: block.block_order ?? 0,
        block_type: block.message_type || "text",
        whatsapp_number_id: resolvedNumberId,
      };

      // attempt 1
      const a1 = await sendBlockOnce(block, group);
      if (a1.ok) {
        await supabase.from("group_campaign_block_dispatches").insert({
          ...trackingRow, status: "sent", attempts: 1, sent_at: new Date().toISOString(),
        });
        return { ok: true };
      }
      // retry
      await sleep(RETRY_DELAY_MS);
      const a2 = await sendBlockOnce(block, group);
      if (a2.ok) {
        await supabase.from("group_campaign_block_dispatches").insert({
          ...trackingRow, status: "sent", attempts: 2, sent_at: new Date().toISOString(),
        });
        return { ok: true };
      }
      await supabase.from("group_campaign_block_dispatches").insert({
        ...trackingRow,
        status: "failed",
        attempts: 2,
        error_message: String(a2.error || a1.error || "send_failed").slice(0, 500),
      });
      return { ok: false, error: a2.error || a1.error };
    }

    // ===== Main sequential loop =====
    let batchSentCount = 0;
    let batchFailedCount = 0;
    const newlySentIds: string[] = [];
    let pausedDuringRun: string | null = null;
    // groups completed so far across the WHOLE message-group (for long-pause cadence)
    let totalGroupsDoneSoFar = alreadySentGroupIds.length;

    try {
      for (let gi = 0; gi < pendingGroups.length; gi++) {
        const group = pendingGroups[gi];

        // Time guard
        const remaining = MAX_FUNCTION_TIME_MS - (Date.now() - functionStartTime);
        if (remaining < TIME_GUARD_MS) {
          console.warn(`Time guard: ${remaining}ms left — stopping batch`);
          break;
        }

        pausedDuringRun = await getPausedGroupSendUntil(supabase);
        if (pausedDuringRun) break;

        // Idempotency: re-check sent_group_ids
        const { data: freshMsg } = await supabase
          .from("group_campaign_scheduled_messages")
          .select("sent_group_ids")
          .eq("id", scheduledMessageId)
          .single();
        const currentSentIds: string[] = freshMsg?.sent_group_ids || [];
        if (currentSentIds.includes(group.id)) continue;

        // Long pause every N groups (based on total done across the message-group)
        if (totalGroupsDoneSoFar > 0 && totalGroupsDoneSoFar % LONG_PAUSE_EVERY_N_GROUPS === 0) {
          const longPause = rand(LONG_PAUSE_MIN_MS, LONG_PAUSE_MAX_MS);
          console.log(`Long pause after ${totalGroupsDoneSoFar} groups: ${Math.round(longPause / 1000)}s`);
          // Renew lock first
          await supabase.from("group_campaign_scheduled_messages")
            .update({ locked_until: new Date(Date.now() + longPause + 60_000).toISOString() })
            .eq(messageGroupId ? "message_group_id" : "id", messageGroupId || scheduledMessageId);
          await sleep(longPause);
          // After long pause, check time budget; cron will continue if needed
          if (MAX_FUNCTION_TIME_MS - (Date.now() - functionStartTime) < TIME_GUARD_MS) break;
        }

        // Send all blocks to this group, sequentially
        let groupHadAnyFail = false;
        for (let bi = 0; bi < allBlocks.length; bi++) {
          const block = allBlocks[bi];
          const res = await sendBlockWithRetry(block, group);
          if (!res.ok) groupHadAnyFail = true;

          // Delay BETWEEN BLOCKS (not after last)
          if (bi < allBlocks.length - 1) {
            await sleep(rand(INTER_BLOCK_DELAY_MIN_MS, INTER_BLOCK_DELAY_MAX_MS));
          }
        }

        if (groupHadAnyFail) batchFailedCount++; else batchSentCount++;
        newlySentIds.push(group.id);
        totalGroupsDoneSoFar++;

        // ===== Persistência INCREMENTAL + renovação da trava =====
        // Grava sent_group_ids assim que o grupo é concluído (não só no finally).
        // Isso garante que, se a trava expirar e o cron re-assumir o disparo,
        // este grupo NÃO será reenviado (evita duplicação nos grupos VIP).
        try {
          const persistSentIds = [...alreadySentGroupIds, ...newlySentIds];
          await supabase
            .from("group_campaign_scheduled_messages")
            .update({
              sent_group_ids: persistSentIds,
              locked_until: new Date(Date.now() + 120_000).toISOString(),
            })
            .eq(messageGroupId ? "message_group_id" : "id", messageGroupId || scheduledMessageId);
        } catch (persistErr) {
          console.error("Falha ao persistir progresso incremental:", persistErr);
        }

        // Delay BETWEEN GROUPS (not after last)
        if (gi < pendingGroups.length - 1) {
          await sleep(rand(INTER_GROUP_DELAY_MIN_MS, INTER_GROUP_DELAY_MAX_MS));
        }
      }
    } catch (e) {
      console.error("Loop error:", e);
    } finally {
      const updatedSentIds = [...alreadySentGroupIds, ...newlySentIds];
      const totalSent = (msg.sent_count || 0) + batchSentCount;
      const totalFailed = (msg.failed_count || 0) + batchFailedCount;
      const isComplete = updatedSentIds.length >= allGroups.length;

      const updatePayload: Record<string, unknown> = {
        sent_group_ids: updatedSentIds,
        sent_count: totalSent,
        failed_count: totalFailed,
      };
      if (pausedDuringRun) {
        updatePayload.status = "cancelled";
        updatePayload.locked_until = null;
      } else if (isComplete) {
        updatePayload.status = totalFailed === allGroups.length ? "failed" : "sent";
        updatePayload.sent_at = new Date().toISOString();
        updatePayload.locked_until = null;
      } else {
        updatePayload.status = "sending";
        updatePayload.locked_until = new Date(Date.now() + 20_000).toISOString();
      }

      if (messageGroupId) {
        await supabase.from("group_campaign_scheduled_messages")
          .update(updatePayload)
          .eq("message_group_id", messageGroupId);
      } else {
        await supabase.from("group_campaign_scheduled_messages")
          .update(updatePayload)
          .eq("id", scheduledMessageId);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        batchSent: batchSentCount,
        batchFailed: batchFailedCount,
        processed: newlySentIds.length,
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
