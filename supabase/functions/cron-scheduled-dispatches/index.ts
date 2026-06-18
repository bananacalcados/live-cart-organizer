// cron-scheduled-dispatches
// Compatibility shim. The new orchestrator handles everything (scheduled promotion,
// worker spawning, and completion). Kept so legacy pg_cron entries don't 404.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { isAuthorizedCron, unauthorizedResponse } from "../_shared/cron-guard.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const res = await fetch(`${supabaseUrl}/functions/v1/dispatch-orchestrator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
      },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    return new Response(JSON.stringify({ delegatedTo: 'dispatch-orchestrator', ...data }), {
      status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
