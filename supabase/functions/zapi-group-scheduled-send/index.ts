import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPEED_DELAYS: Record<string, [number, number]> = {
  slow: [8000, 15000],
  normal: [3000, 8000],
  fast: [1000, 3000],
};

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

    // Fetch scheduled message
    const { data: msg, error: msgErr } = await supabase
      .from('group_campaign_scheduled_messages')
      .select('*, group_campaigns!inner(id, target_groups, send_speed)')
      .eq('id', scheduledMessageId)
      .single();

    if (msgErr || !msg) {
      return new Response(
        JSON.stringify({ error: 'Scheduled message not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Allow retrying messages stuck in 'sending' for more than 2 minutes
    if (msg.status !== 'pending') {
      if (msg.status === 'sending') {
        const updatedAt = new Date(msg.updated_at || msg.created_at);
        const minutesAgo = (Date.now() - updatedAt.getTime()) / 60000;
        if (minutesAgo < 2) {
          return new Response(
            JSON.stringify({ error: 'Message is currently being sent, please wait', status: msg.status }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // Reset to allow retry
        console.log(`Retrying stuck message ${scheduledMessageId} (stuck for ${minutesAgo.toFixed(1)} min)`);
      } else {
        return new Response(
          JSON.stringify({ error: 'Message already processed', status: msg.status }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Mark as sending
    await supabase.from('group_campaign_scheduled_messages')
      .update({ status: 'sending' })
      .eq('id', scheduledMessageId);

    const campaign = msg.group_campaigns;
    const campaignId = campaign.id;
    const targetGroupIds = campaign.target_groups || [];
    const speed = msg.send_speed || campaign.send_speed || 'normal';
    const [minDelay, maxDelay] = SPEED_DELAYS[speed] || SPEED_DELAYS.normal;

    // Fetch campaign variables for substitution
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

    // Add built-in variables
    const now = new Date();
    campaignVars['data_hoje'] = now.toLocaleDateString('pt-BR');
    campaignVars['horario'] = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Fetch groups
    const { data: groups } = await supabase
      .from('whatsapp_groups')
      .select('id, group_id, name')
      .in('id', targetGroupIds);

    if (!groups || groups.length === 0) {
      await supabase.from('group_campaign_scheduled_messages')
        .update({ status: 'failed' })
        .eq('id', scheduledMessageId);
      return new Response(
        JSON.stringify({ error: 'No valid groups found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Helper to replace variables in text
    const replaceVars = (text: string, groupName: string): string => {
      let result = text;
      // Replace campaign variables
      for (const [key, value] of Object.entries(campaignVars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
      // Replace group-specific variables
      result = result.replace(/\{\{nome_grupo\}\}/g, groupName);
      return result;
    };

    let sentCount = 0;
    let failedCount = 0;

    // Resolve whatsapp_number_id from message or campaign
    const resolvedNumberId = msg.whatsapp_number_id || campaign.whatsapp_number_id || null;

    for (const group of groups) {
      try {
        let endpoint = 'zapi-send-group-message';
        const body: Record<string, unknown> = {
          groupId: group.group_id,
          mentionAll: msg.mention_all || false,
          whatsapp_number_id: resolvedNumberId,
        };

        // Apply variable substitution to message content
        const messageContent = msg.message_content ? replaceVars(msg.message_content, group.name) : '';

        if (msg.message_type === 'poll' && msg.poll_options) {
          endpoint = 'zapi-send-group-message';
          body.type = 'poll';
          body.pollOptions = msg.poll_options;
          body.message = messageContent;
          body.pollMaxOptions = msg.poll_max_options ?? 1;
        } else if (msg.message_type !== 'text' && msg.media_url) {
          body.type = msg.message_type;
          body.mediaUrl = msg.media_url;
          body.caption = messageContent;
          body.message = messageContent;
        } else {
          body.type = 'text';
          body.message = messageContent;
        }

        const sendRes = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        const sendData = await sendRes.json();
        if (sendRes.ok && sendData.success) {
          sentCount++;
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }

      // Delay between groups
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      await new Promise(r => setTimeout(r, delay));
    }

    // Update scheduled message status
    await supabase.from('group_campaign_scheduled_messages')
      .update({
        status: failedCount === groups.length ? 'failed' : 'sent',
        sent_at: new Date().toISOString(),
        sent_count: sentCount,
        failed_count: failedCount,
      })
      .eq('id', scheduledMessageId);

    return new Response(
      JSON.stringify({ success: true, sentCount, failedCount, total: groups.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in scheduled send:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
