import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPausedGroupSendUntil } from "../_shared/group-send-guard.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPEED_DELAYS: Record<string, [number, number]> = {
  slow: [8000, 15000],
  normal: [3000, 8000],
  fast: [1000, 3000],
};

const INTER_BLOCK_DELAY = 1500;
const BASE_MAX_GROUPS_PER_BATCH = 5;
const MAX_FUNCTION_TIME_MS = 50000; // 50s safety margin (limit is 60s)
const ESTIMATED_API_CALL_MS = 2000; // ~2s per API call


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { scheduledMessageId } = await req.json();

    if (!scheduledMessageId) {
      return new Response(
        JSON.stringify({ error: 'scheduledMessageId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: existingMsg, error: existingMsgErr } = await supabase
      .from('group_campaign_scheduled_messages')
      .select('id, status, locked_until, message_group_id')
      .eq('id', scheduledMessageId)
      .maybeSingle();

    if (existingMsgErr || !existingMsg) {
      return new Response(
        JSON.stringify({ error: 'Scheduled message not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pausedBeforeStart = await getPausedGroupSendUntil(supabase);
    if (pausedBeforeStart) {
      if (existingMsg.message_group_id) {
        await supabase.from('group_campaign_scheduled_messages')
          .update({ status: 'cancelled' })
          .eq('message_group_id', existingMsg.message_group_id)
          .in('status', ['pending', 'sending']);
      } else {
        await supabase.from('group_campaign_scheduled_messages')
          .update({ status: 'cancelled' })
          .eq('id', scheduledMessageId)
          .in('status', ['pending', 'sending']);
      }

      return new Response(
        JSON.stringify({ error: 'Group sends temporarily paused', pausedUntil: pausedBeforeStart }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Atomically claim this batch before reading the full payload.
    // This prevents the manual trigger and cron from sending the same groups simultaneously.
    // Check lock in code (PostgREST schema cache may not know about locked_until yet)
    if (existingMsg.locked_until && new Date(existingMsg.locked_until).getTime() > Date.now()) {
      return new Response(
        JSON.stringify({ error: 'Message is already being processed', status: existingMsg.status, lockedUntil: existingMsg.locked_until }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lockUntil = new Date(Date.now() + 90_000).toISOString();
    const nowForClaim = new Date().toISOString();
    const { data: claimedRows, error: claimErr } = await supabase
      .from('group_campaign_scheduled_messages')
      .update({
        status: 'sending',
        locked_until: lockUntil,
        last_execution_at: nowForClaim,
      })
      .eq('id', scheduledMessageId)
      .eq('status', 'pending')
      .or(`locked_until.is.null,locked_until.lt.${nowForClaim}`)
      .select('id, message_group_id');

    if (claimErr) {
      return new Response(
        JSON.stringify({ error: 'Failed to claim scheduled message', details: claimErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const claimedMsg = claimedRows?.[0] ?? null;

    if (!claimedMsg) {
      if (existingMsg.status !== 'pending' && existingMsg.status !== 'sending') {
        return new Response(
          JSON.stringify({ error: 'Message already processed', status: existingMsg.status }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Message is already being processed', status: existingMsg.status, lockedUntil: existingMsg.locked_until }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Also mark sibling blocks as sending so cron cannot pick another block from the same grouped message.
    if (claimedMsg.message_group_id) {
      await supabase.from('group_campaign_scheduled_messages')
        .update({ status: 'sending' })
        .eq('message_group_id', claimedMsg.message_group_id)
        .in('status', ['pending', 'grouped']);
    }

    // Fetch scheduled message after the claim succeeds.
    const { data: msg, error: msgErr } = await supabase
      .from('group_campaign_scheduled_messages')
      .select('*, group_campaigns!inner(id, target_groups, send_speed, whatsapp_number_id)')
      .eq('id', scheduledMessageId)
      .single();

    if (msgErr || !msg) {
      return new Response(
        JSON.stringify({ error: 'Scheduled message not found after claim' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const campaign = msg.group_campaigns;
    const campaignId = campaign.id;
    const targetGroupIds: string[] = campaign.target_groups || [];
    const speed = msg.send_speed || campaign.send_speed || 'normal';
    const [minDelay, maxDelay] = SPEED_DELAYS[speed] || SPEED_DELAYS.normal;

    // Track already sent groups
    const alreadySentGroupIds: string[] = msg.sent_group_ids || [];

    // Fetch campaign variables
    const { data: varsData } = await supabase
      .from('campaign_variables')
      .select('variable_name, variable_value')
      .eq('campaign_id', campaignId);

    const campaignVars: Record<string, string> = {};
    if (varsData) {
      for (const v of varsData) {
        campaignVars[v.variable_name] = v.variable_value;
      }
    }

    const now = new Date();
    campaignVars['data_hoje'] = now.toLocaleDateString('pt-BR');
    campaignVars['horario'] = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Fetch ALL groups, then filter out already sent
    const { data: allGroups } = await supabase
      .from('whatsapp_groups')
      .select('id, group_id, name')
      .in('id', targetGroupIds);

    if (!allGroups || allGroups.length === 0) {
      await supabase.from('group_campaign_scheduled_messages')
        .update({ status: 'failed' })
        .eq('id', scheduledMessageId);
      return new Response(
        JSON.stringify({ error: 'No valid groups found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter out already sent groups
    const pendingGroups = allGroups.filter(g => !alreadySentGroupIds.includes(g.id));

    if (pendingGroups.length === 0) {
      // All groups already processed - finalize
      const totalSent = msg.sent_count || alreadySentGroupIds.length;
      await supabase.from('group_campaign_scheduled_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString(), sent_count: totalSent, failed_count: msg.failed_count || 0 })
        .eq('id', scheduledMessageId);
      return new Response(
        JSON.stringify({ success: true, complete: true, sentCount: totalSent, failedCount: 0, total: allGroups.length }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine multi-block messages
    let allBlocks: any[] = [msg];
    const messageGroupId = msg.message_group_id;

    if (messageGroupId) {
      const { data: groupedBlocks, error: gbErr } = await supabase
        .from('group_campaign_scheduled_messages')
        .select('*')
        .eq('message_group_id', messageGroupId)
        .order('block_order', { ascending: true });

      if (!gbErr && groupedBlocks && groupedBlocks.length > 0) {
        allBlocks = groupedBlocks;
        console.log(`Multi-block message: ${allBlocks.length} blocks`);
        await supabase.from('group_campaign_scheduled_messages')
          .update({ status: 'sending' })
          .eq('message_group_id', messageGroupId);
      }
    }

    // Dynamically calculate batch size based on block count to stay under timeout
    const blockCount = allBlocks.length;
    const estimatedTimePerGroup = blockCount * (INTER_BLOCK_DELAY + ESTIMATED_API_CALL_MS);
    const dynamicBatchSize = Math.max(
      1,
      Math.min(BASE_MAX_GROUPS_PER_BATCH, Math.floor(MAX_FUNCTION_TIME_MS / estimatedTimePerGroup)),
    );

    const batch = pendingGroups.slice(0, dynamicBatchSize);
    console.log(`Processing batch: ${batch.length} groups (${pendingGroups.length} remaining of ${allGroups.length} total, ${blockCount} blocks, ~${Math.round(estimatedTimePerGroup / 1000)}s/group)`);

    const replaceVars = (text: string, groupName: string): string => {
      let result = text;
      for (const [key, value] of Object.entries(campaignVars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
      result = result.replace(/\{\{nome_grupo\}\}/g, groupName);
      return result;
    };

    const resolvedNumberId = msg.whatsapp_number_id || campaign.whatsapp_number_id || null;

    let batchSentCount = 0;
    let batchFailedCount = 0;
    const newlySentIds: string[] = [];
    let pausedDuringRun: string | null = null;

    for (const group of batch) {
      pausedDuringRun = await getPausedGroupSendUntil(supabase);
      if (pausedDuringRun) {
        console.log(`Stopping batch early because group sends are paused until ${pausedDuringRun}`);
        break;
      }

      let groupSuccess = true;
      for (let blockIdx = 0; blockIdx < allBlocks.length; blockIdx++) {
        const block = allBlocks[blockIdx];
        try {
          const body: Record<string, unknown> = {
            groupId: group.group_id,
            mentionAll: block.mention_all || false,
            whatsapp_number_id: resolvedNumberId,
          };

          const messageContent = block.message_content ? replaceVars(block.message_content, group.name) : '';

          if (block.message_type === 'poll' && block.poll_options) {
            body.type = 'poll';
            body.pollOptions = block.poll_options;
            body.message = messageContent;
            body.pollMaxOptions = block.poll_max_options ?? 1;
          } else if (block.message_type !== 'text' && block.media_url) {
            body.type = block.message_type;
            body.mediaUrl = block.media_url;
            body.caption = messageContent;
            body.message = messageContent;
          } else {
            body.type = 'text';
            body.message = messageContent;
          }

          const sendRes = await fetch(`${supabaseUrl}/functions/v1/zapi-send-group-message`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });

          const sendData = await sendRes.json();
          if (!sendRes.ok || !sendData.success) {
            groupSuccess = false;
          }
        } catch {
          groupSuccess = false;
        }

        if (blockIdx < allBlocks.length - 1) {
          await new Promise(r => setTimeout(r, INTER_BLOCK_DELAY));
        }
      }

      if (groupSuccess) {
        batchSentCount++;
      } else {
        batchFailedCount++;
      }
      newlySentIds.push(group.id);

      // Delay between groups (skip after last in batch)
      if (group !== batch[batch.length - 1]) {
        const delay = minDelay + Math.random() * (maxDelay - minDelay);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    // Update progress
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
      updatePayload.status = 'cancelled';
      console.log(`Batch cancelled after ${updatedSentIds.length}/${allGroups.length} groups`);
    } else if (isComplete) {
      updatePayload.status = totalFailed === allGroups.length ? 'failed' : 'sent';
      updatePayload.sent_at = new Date().toISOString();
      console.log(`Complete! ${totalSent} sent, ${totalFailed} failed out of ${allGroups.length}`);
    } else {
      // Keep as 'sending' — cron will pick it up again
      updatePayload.status = 'sending';
      console.log(`Batch done. ${updatedSentIds.length}/${allGroups.length} groups processed so far`);
    }

    if (messageGroupId) {
      await supabase.from('group_campaign_scheduled_messages')
        .update(updatePayload)
        .eq('message_group_id', messageGroupId);
    } else {
      await supabase.from('group_campaign_scheduled_messages')
        .update(updatePayload)
        .eq('id', scheduledMessageId);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        complete: isComplete,
        batchSent: batchSentCount,
        batchFailed: batchFailedCount,
        sentCount: totalSent, 
        failedCount: totalFailed, 
        total: allGroups.length,
        processed: updatedSentIds.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in scheduled send:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
