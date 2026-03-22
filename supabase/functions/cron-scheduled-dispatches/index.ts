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

    // Find scheduled dispatches that are due
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

    if (!dueDispatches || dueDispatches.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No scheduled dispatches due' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const triggered: string[] = [];

    for (const dispatch of dueDispatches) {
      // Update status to 'sending'
      const { error: updateErr } = await supabase
        .from('dispatch_history')
        .update({ status: 'sending', started_at: new Date().toISOString() })
        .eq('id', dispatch.id)
        .eq('status', 'scheduled'); // Prevent race conditions

      if (updateErr) {
        console.error(`Failed to update dispatch ${dispatch.id}:`, updateErr);
        continue;
      }

      // Trigger VPS dispatcher via proxy
      fetch(`${supabaseUrl}/functions/v1/vps-dispatch-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
        body: JSON.stringify({ dispatch_id: dispatch.id }),
      }).catch(err => console.error(`Failed to trigger dispatch ${dispatch.id}:`, err));

      triggered.push(dispatch.id);
    }

    return new Response(JSON.stringify({ success: true, triggered }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('cron-scheduled-dispatches error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
