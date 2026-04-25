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

    // 1. Find scheduled dispatches that are due
    const { data: dueDispatches, error } = await supabase
      .from('dispatch_history')
      .select('id')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .limit(5);

    if (error) {
      console.error('Error fetching scheduled dispatches:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const triggered: string[] = [];
    const resumed: string[] = [];

    for (const dispatch of (dueDispatches || [])) {
      const { error: updateErr } = await supabase
        .from('dispatch_history')
        .update({ status: 'sending', started_at: new Date().toISOString() })
        .eq('id', dispatch.id)
        .eq('status', 'scheduled');

      if (updateErr) {
        console.error(`Failed to update dispatch ${dispatch.id}:`, updateErr);
        continue;
      }

      fetch(`${supabaseUrl}/functions/v1/dispatch-mass-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
        body: JSON.stringify({ dispatchId: dispatch.id }),
      }).catch(err => console.error(`Failed to trigger dispatch ${dispatch.id}:`, err));

      triggered.push(dispatch.id);
    }

    // 2. RECOVERY: Find "sending" dispatches stuck (no activity for >45s, processing_batch=false)
    // These are orphaned chains that died mid-processing.
    const staleThreshold = new Date(Date.now() - 45_000).toISOString();
    const { data: staleDispatches } = await supabase
      .from('dispatch_history')
      .select('id, started_at, processing_batch')
      .eq('status', 'sending')
      .eq('processing_batch', false)
      .lt('started_at', staleThreshold)
      .limit(5);

    for (const stale of (staleDispatches || [])) {
      console.log(`[recovery] Resuming orphaned dispatch ${stale.id} (last started_at: ${stale.started_at})`);
      fetch(`${supabaseUrl}/functions/v1/dispatch-mass-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
        body: JSON.stringify({ dispatchId: stale.id }),
      }).catch(err => console.error(`Failed to resume dispatch ${stale.id}:`, err));
      resumed.push(stale.id);
    }

    return new Response(JSON.stringify({ success: true, triggered, resumed }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('cron-scheduled-dispatches error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
