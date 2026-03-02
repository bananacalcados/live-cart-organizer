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
      .select('*, group_campaigns!inner(target_groups, send_speed)')
      .eq('id', scheduledMessageId)
      .single();

    if (msgErr || !msg) {
      return new Response(
        JSON.stringify({ error: 'Scheduled message not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (msg.status !== 'pending') {
      return new Response(
        JSON.stringify({ error: 'Message already processed', status: msg.status }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark as sending
    await supabase.from('group_campaign_scheduled_messages')
      .update({ status: 'sending' })
      .eq('id', scheduledMessageId);

    const campaign = msg.group_campaigns;
    const targetGroupIds = campaign.target_groups || [];
    const speed = msg.send_speed || campaign.send_speed || 'normal';
    const [minDelay, maxDelay] = SPEED_DELAYS[speed] || SPEED_DELAYS.normal;

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

    let sentCount = 0;
    let failedCount = 0;

    for (const group of groups) {
      try {
        let endpoint = 'zapi-send-group-message';
        const body: Record<string, unknown> = {
          groupId: group.group_id,
        };

        if (msg.message_type === 'poll' && msg.poll_options) {
          // Use Z-API poll endpoint
          endpoint = 'zapi-send-group-message';
          body.type = 'poll';
          body.pollOptions = msg.poll_options;
          body.message = msg.message_content || '';
        } else if (msg.message_type !== 'text' && msg.media_url) {
          body.type = msg.message_type;
          body.mediaUrl = msg.media_url;
          body.caption = msg.message_content || '';
          body.message = msg.message_content || '';
        } else {
          body.type = 'text';
          body.message = msg.message_content || '';
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
