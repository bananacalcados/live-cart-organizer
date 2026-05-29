// dispatch-orchestrator
// Runs every 30s via pg_cron. Looks at active dispatches with pending work
// and spawns N workers per dispatch (fire-and-forget). Workers self-coordinate
// via lease lock — extra workers just find nothing to claim, no duplication.
//
// Also: promotes scheduled→sending and finalizes empty dispatches.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_WORKERS_PER_DISPATCH = 5; // lowered from 10 to avoid DB connection-pool saturation
const JOBS_PER_WORKER = 300; // 1 worker covers ~300 pending jobs in 50s

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Promote any scheduled dispatches that became due
    const { data: due } = await supabase
      .from('dispatch_history')
      .select('id')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .limit(10);

    for (const d of due || []) {
      await supabase.from('dispatch_history')
        .update({ status: 'sending', started_at: new Date().toISOString(), processing_batch: false })
        .eq('id', d.id).eq('status', 'scheduled');
    }

    // 2. Find dispatches with pending work
    const { data: pending, error: pendErr } = await supabase.rpc('get_dispatches_with_pending', { p_limit: 20 });
    if (pendErr) {
      console.error('get_dispatches_with_pending error:', pendErr);
      return new Response(JSON.stringify({ error: pendErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const spawned: { dispatchId: string; workers: number; pending: number }[] = [];

    for (const row of pending || []) {
      const dispatchId = (row as any).dispatch_id;
      const pendingCount = Number((row as any).pending_count) || 0;
      const desired = Math.min(
        MAX_WORKERS_PER_DISPATCH,
        Math.max(1, Math.ceil(pendingCount / JOBS_PER_WORKER)),
      );

      for (let i = 0; i < desired; i++) {
        // Fire and forget — DO NOT await
        fetch(`${supabaseUrl}/functions/v1/dispatch-worker`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
            'apikey': serviceKey,
          },
          body: JSON.stringify({ dispatchId }),
        }).catch(err => console.error(`worker spawn failed for ${dispatchId}:`, err));
      }

      spawned.push({ dispatchId, workers: desired, pending: pendingCount });
    }

    // 3. Finalize any dispatch that has no remaining work
    const { data: finalized } = await supabase.rpc('finalize_completed_dispatches');

    return new Response(JSON.stringify({
      success: true,
      promoted: (due || []).length,
      spawned,
      finalized: finalized || 0,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('orchestrator fatal:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
