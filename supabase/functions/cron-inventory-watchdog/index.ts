import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALL_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes without heartbeat = stalled

/**
 * Watchdog cron: checks for stalled inventory verification/correction
 * and re-triggers the appropriate edge function.
 * Should be called every 2 minutes via pg_cron.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || serviceRoleKey;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = Date.now();
    const actions: string[] = [];

    // Find counts that are stuck in 'verifying' or 'correcting'
    const { data: stalledCounts } = await supabase
      .from('inventory_counts')
      .select('id, status, store_id, last_batch_at')
      .in('status', ['verifying', 'correcting']);

    if (!stalledCounts || stalledCounts.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No active counts', actions }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const count of stalledCounts) {
      const lastBatch = count.last_batch_at ? new Date(count.last_batch_at).getTime() : 0;
      const elapsed = now - lastBatch;

      if (elapsed < STALL_THRESHOLD_MS) {
        // Still running, skip
        actions.push(`count=${count.id} status=${count.status} last_batch=${Math.round(elapsed / 1000)}s ago — OK`);
        continue;
      }

      // Stalled! Re-trigger the appropriate function
      if (count.status === 'verifying') {
        console.log(`[watchdog] Re-triggering verify for count ${count.id} (stalled ${Math.round(elapsed / 1000)}s)`);
        
        const invokePromise = fetch(`${supabaseUrl}/functions/v1/inventory-verify-and-correct`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            count_id: count.id,
            store_id: count.store_id,
            batch_size: 8,
            also_correct: false,
          }),
        }).then(async (r) => {
          const body = await r.text();
          console.log(`[watchdog] Re-triggered verify response: ${r.status} ${body.substring(0, 200)}`);
        }).catch(e => console.error('[watchdog] Re-trigger verify failed:', e));

        const edgeRuntime = (globalThis as typeof globalThis & {
          EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
        }).EdgeRuntime;
        if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(invokePromise);

        actions.push(`count=${count.id} STALLED verify — re-triggered (${Math.round(elapsed / 1000)}s)`);
      }

      if (count.status === 'correcting') {
        console.log(`[watchdog] Re-triggering correction for count ${count.id} (stalled ${Math.round(elapsed / 1000)}s)`);
        
        const invokePromise = fetch(`${supabaseUrl}/functions/v1/inventory-correct-stock`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            count_id: count.id,
            batch_size: 10,
          }),
        }).then(async (r) => {
          const body = await r.text();
          console.log(`[watchdog] Re-triggered correction response: ${r.status} ${body.substring(0, 200)}`);
        }).catch(e => console.error('[watchdog] Re-trigger correction failed:', e));

        const edgeRuntime = (globalThis as typeof globalThis & {
          EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
        }).EdgeRuntime;
        if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(invokePromise);

        actions.push(`count=${count.id} STALLED correction — re-triggered (${Math.round(elapsed / 1000)}s)`);
      }
    }

    console.log(`[watchdog] Actions: ${JSON.stringify(actions)}`);

    return new Response(JSON.stringify({ success: true, actions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[watchdog] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
