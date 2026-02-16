import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { campaignId } = await req.json();

    if (!campaignId) {
      return new Response(
        JSON.stringify({ error: 'campaignId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch campaign
    const { data: campaign, error: campErr } = await supabase
      .from('group_campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campErr || !campaign) {
      return new Response(
        JSON.stringify({ error: 'Campaign not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update status to sending
    await supabase.from('group_campaigns').update({
      status: 'sending',
      started_at: new Date().toISOString(),
    }).eq('id', campaignId);

    // Get target groups
    const targetGroupIds = campaign.target_groups || [];
    if (targetGroupIds.length === 0) {
      await supabase.from('group_campaigns').update({ status: 'failed' }).eq('id', campaignId);
      return new Response(
        JSON.stringify({ error: 'No target groups' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: groups } = await supabase
      .from('whatsapp_groups')
      .select('id, group_id, name')
      .in('id', targetGroupIds);

    if (!groups || groups.length === 0) {
      await supabase.from('group_campaigns').update({ status: 'failed' }).eq('id', campaignId);
      return new Response(
        JSON.stringify({ error: 'No valid groups found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create campaign message records
    const messageRecords = groups.map(g => ({
      campaign_id: campaignId,
      group_id: g.id,
      status: 'pending',
    }));

    await supabase.from('group_campaign_messages').insert(messageRecords);

    // Determine content to send
    const messageContent = campaign.ai_generated_content || campaign.message_content || '';
    const messageType = campaign.message_type || 'text';
    const mediaUrl = campaign.media_url || null;

    let sentCount = 0;
    let failedCount = 0;
    const errors: any[] = [];

    // Send to each group with delay to avoid rate limiting
    for (const group of groups) {
      try {
        const sendRes = await fetch(`${supabaseUrl}/functions/v1/zapi-send-group-message`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            groupId: group.group_id,
            message: messageContent,
            type: messageType,
            mediaUrl,
            caption: messageContent,
            campaignId,
            groupDbId: group.id,
          }),
        });

        const sendData = await sendRes.json();

        if (sendRes.ok && sendData.success) {
          sentCount++;
        } else {
          failedCount++;
          errors.push({ group: group.name, error: sendData.error || 'Unknown error' });
        }
      } catch (err) {
        failedCount++;
        errors.push({ group: group.name, error: err.message });
      }

      // Random delay between 3-8 seconds between groups
      const delay = 3000 + Math.random() * 5000;
      await new Promise(r => setTimeout(r, delay));
    }

    // Update campaign status
    await supabase.from('group_campaigns').update({
      status: failedCount === groups.length ? 'failed' : 'completed',
      completed_at: new Date().toISOString(),
      sent_count: sentCount,
      failed_count: failedCount,
      total_groups: groups.length,
      error_log: errors,
    }).eq('id', campaignId);

    return new Response(
      JSON.stringify({ success: true, sentCount, failedCount, total: groups.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error executing campaign:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
