// vps-dispatch-proxy
// Now a thin enqueue + kickstart endpoint.
// 1. Marks the dispatch as 'sending' (idempotent)
// 2. Fires off one dispatch-worker immediately (fire-and-forget) so the user
//    sees activity within seconds. The orchestrator cron will keep adding workers
//    as needed until the queue is drained.
//
// No more VPS dependency, no more recursive chaining, no more orphan recovery.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function isInternalRequest(req: Request, serviceKey: string) {
  const authHeader = req.headers.get('Authorization') || '';
  const apiKey = req.headers.get('apikey') || '';
  return authHeader === `Bearer ${serviceKey}` || apiKey === serviceKey;
}

async function requireStaffOrInternal(req: Request, serviceKey: string) {
  if (isInternalRequest(req, serviceKey)) return { ok: true as const };

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return { ok: false as const, status: 401, error: 'Unauthorized' };

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const token = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return { ok: false as const, status: 401, error: 'Unauthorized' };

  const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const roleChecks = await Promise.all([
    serviceClient.rpc('has_role', { _user_id: userId, _role: 'admin' }),
    serviceClient.rpc('has_role', { _user_id: userId, _role: 'manager' }),
    serviceClient.rpc('has_module_access', { _user_id: userId, _module: 'marketing' }),
  ]);
  const allowed = roleChecks.some((result) => result.data === true);
  if (!allowed) return { ok: false as const, status: 403, error: 'Forbidden' };

  return { ok: true as const };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = await requireStaffOrInternal(req, serviceKey);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { dispatch_id, dispatchId, action } = body;
    const id = dispatch_id || dispatchId;
    if (!id) {
      return new Response(JSON.stringify({ error: 'dispatch_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Legacy "status" action — emulate by aggregating recipients
    if (action === 'status') {
      const { data: d } = await supabase.from('dispatch_history')
        .select('id,status,sent_count,failed_count,total_recipients,completed_at').eq('id', id).single();
      return new Response(JSON.stringify({ ...d, via: 'native' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ensure the dispatch is in 'sending' state (idempotent)
    const { data: d } = await supabase.from('dispatch_history')
      .select('id,status').eq('id', id).single();
    if (!d) {
      return new Response(JSON.stringify({ error: 'Dispatch not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (['cancelled', 'paused', 'completed'].includes(d.status)) {
      return new Response(JSON.stringify({ skipped: true, status: d.status }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (d.status === 'scheduled') {
      // Keep scheduled; orchestrator will promote when due
      return new Response(JSON.stringify({ queued: true, status: 'scheduled' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('dispatch_history').update({
      status: 'sending',
      started_at: new Date().toISOString(),
      processing_batch: false,
    }).eq('id', id).in('status', ['pending', 'sending']);

    // Kick several workers immediately (fire and forget) so big audiences start
    // draining within seconds instead of waiting for the 30s orchestrator cron.
    // Workers self-coordinate via lease lock — extra workers just find nothing.
    const INITIAL_WORKERS = 4;
    for (let i = 0; i < INITIAL_WORKERS; i++) {
      fetch(`${supabaseUrl}/functions/v1/dispatch-worker`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
        },
        body: JSON.stringify({ dispatchId: id }),
      }).catch(err => console.error(`kickstart worker failed for ${id}:`, err));
    }

    return new Response(JSON.stringify({ success: true, dispatchId: id, via: 'native-queue' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[vps-dispatch-proxy] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
