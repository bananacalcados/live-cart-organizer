import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Cron job: checks all active campaigns for groups nearing capacity (>= 900 participants).
 * If all groups in a campaign are >= 900, proactively creates a new one.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get all active campaigns
    const { data: campaigns } = await supabase
      .from('group_campaigns')
      .select('id, name, target_groups')
      .eq('is_active', true);

    if (!campaigns || campaigns.length === 0) {
      console.log('No active campaigns');
      return new Response(JSON.stringify({ success: true, checked: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let created = 0;
    const standbyThreshold = 950; // Create standby group when any group reaches 950

    for (const campaign of campaigns) {
      const targetGroupIds: string[] = campaign.target_groups || [];
      if (targetGroupIds.length === 0) continue;

      // Check groups status
      const { data: groups } = await supabase
        .from('whatsapp_groups')
        .select('id, participant_count, max_participants, is_full')
        .in('id', targetGroupIds);

      if (!groups || groups.length === 0) continue;

      // Proactive: if any group has >= 950 participants, check if there's a standby (low-count) group ready
      const hasGroupNearFull = groups.some(g =>
        !g.is_full && (g.participant_count || 0) >= standbyThreshold
      );
      const hasStandbyGroup = groups.some(g =>
        !g.is_full && (g.participant_count || 0) < standbyThreshold
      );

      // Only create if there's a group nearing capacity but no standby exists
      if (!hasGroupNearFull || hasStandbyGroup) continue;

      console.log(`Campaign "${campaign.name}" has all groups near full (>=${threshold}). Auto-creating...`);

      // Call auto-create
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/auto-create-vip-group`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ campaign_id: campaign.id }),
        });
        const result = await res.json();
        if (result.success && !result.skipped) {
          console.log(`Auto-created group for campaign "${campaign.name}": ${result.group?.name}`);
          created++;
        }
      } catch (e) {
        console.error(`Failed to auto-create for campaign ${campaign.id}:`, e);
      }
    }

    console.log(`Cron check complete. Campaigns checked: ${campaigns.length}, Groups created: ${created}`);

    return new Response(
      JSON.stringify({ success: true, checked: campaigns.length, created }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in cron check:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
