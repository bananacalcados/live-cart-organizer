import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALL_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes without heartbeat = stalled
const AUDIT_STALL_THRESHOLD_MS = 4 * 60 * 1000;

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

    // Find counts that are stuck in 'verifying', 'correcting' or 'smart_correcting'
    const { data: stalledCounts } = await supabase
      .from('inventory_counts')
      .select('id, status, store_id, last_batch_at')
      .in('status', ['verifying', 'correcting', 'smart_correcting']);

    const edgeRuntime = (globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }).EdgeRuntime;

    for (const count of stalledCounts || []) {
      const lastBatch = count.last_batch_at ? new Date(count.last_batch_at).getTime() : 0;
      const elapsed = now - lastBatch;

      if (elapsed < STALL_THRESHOLD_MS) {
        actions.push(`count=${count.id} status=${count.status} last_batch=${Math.round(elapsed / 1000)}s ago — OK`);
        continue;
      }

      if (count.status === 'verifying') {
        console.log(`[watchdog] Re-triggering verify for count ${count.id} (stalled ${Math.round(elapsed / 1000)}s)`);
        const invokePromise = fetch(`${supabaseUrl}/functions/v1/inventory-verify-and-correct`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
          },
          body: JSON.stringify({ count_id: count.id, store_id: count.store_id, batch_size: 8, also_correct: false }),
        }).then(async (r) => {
          const body = await r.text();
          console.log(`[watchdog] Re-triggered verify response: ${r.status} ${body.substring(0, 200)}`);
        }).catch(e => console.error('[watchdog] Re-trigger verify failed:', e));
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
          body: JSON.stringify({ count_id: count.id, batch_size: 10 }),
        }).then(async (r) => {
          const body = await r.text();
          console.log(`[watchdog] Re-triggered correction response: ${r.status} ${body.substring(0, 200)}`);
        }).catch(e => console.error('[watchdog] Re-trigger correction failed:', e));
        if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(invokePromise);
        actions.push(`count=${count.id} STALLED correction — re-triggered (${Math.round(elapsed / 1000)}s)`);
      }
    }

    const { data: auditRuns } = await supabase
      .from('inventory_audit_runs')
      .select('id, status, per_store, created_at')
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(3);

    for (const run of auditRuns || []) {
      const perStore = Array.isArray(run.per_store) ? run.per_store : [];
      const unfinishedStores = perStore.filter((store: any) => store && !store.finished);
      if (unfinishedStores.length === 0) continue;

      const latestHeartbeat = unfinishedStores.reduce((latest: number, store: any) => {
        const candidates = [store?.last_progress_at, store?.stage2_started_at, run.created_at]
          .filter(Boolean)
          .map((value) => new Date(value).getTime())
          .filter((value) => Number.isFinite(value));
        const storeLatest = candidates.length ? Math.max(...candidates) : 0;
        return Math.max(latest, storeLatest);
      }, 0);

      const elapsed = now - latestHeartbeat;
      if (elapsed < AUDIT_STALL_THRESHOLD_MS) {
        actions.push(`audit=${run.id} running heartbeat=${Math.round(elapsed / 1000)}s ago — OK`);
        continue;
      }

      console.log(`[watchdog] Re-triggering inventory audit ${run.id} (stalled ${Math.round(elapsed / 1000)}s)`);
      const invokePromise = fetch(`${supabaseUrl}/functions/v1/inventory-audit-tiny`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ run_id: run.id, update_only: true }),
      }).then(async (r) => {
        const body = await r.text();
        console.log(`[watchdog] Re-triggered audit response: ${r.status} ${body.substring(0, 200)}`);
      }).catch(e => console.error('[watchdog] Re-trigger audit failed:', e));

      if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(invokePromise);
      actions.push(`audit=${run.id} STALLED — re-triggered (${Math.round(elapsed / 1000)}s)`);
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
