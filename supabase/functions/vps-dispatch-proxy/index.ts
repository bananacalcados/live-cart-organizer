import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const VPS_URL = 'https://dispatcher.bananacalcados.com.br';
const VPS_SECRET = 'banana2025dispatcher';
const VPS_TIMEOUT_MS = 8000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { dispatch_id, dispatchId, action } = body;
    const id = dispatch_id || dispatchId;

    if (!id) {
      return new Response(JSON.stringify({ error: 'dispatch_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Status check — only VPS
    if (action === 'status') {
      try {
        const res = await fetch(`${VPS_URL}/status/${id}`, { method: 'GET' });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'VPS unreachable', details: String(err) }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Dispatch — try VPS first, fallback to Edge Function
    let vpsSuccess = false;
    let vpsData: any = null;

    try {
      console.log(`[vps-proxy] Trying VPS: POST ${VPS_URL}/dispatch`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VPS_TIMEOUT_MS);

      const res = await fetch(`${VPS_URL}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispatch_id: id, secret: VPS_SECRET }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      vpsData = await res.json();

      if (res.ok && !vpsData.error) {
        vpsSuccess = true;
        console.log(`[vps-proxy] VPS accepted dispatch ${id}`);
      } else {
        console.warn(`[vps-proxy] VPS rejected: ${JSON.stringify(vpsData)}`);
      }
    } catch (vpsErr) {
      console.warn(`[vps-proxy] VPS failed: ${String(vpsErr)}`);
    }

    if (vpsSuccess) {
      return new Response(JSON.stringify({ ...vpsData, via: 'vps' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fallback: invoke dispatch-mass-send Edge Function
    console.log(`[vps-proxy] Falling back to Edge Function for dispatch ${id}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const efRes = await fetch(`${supabaseUrl}/functions/v1/dispatch-mass-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
      },
      body: JSON.stringify({ dispatchId: id }),
    });

    const efData = await efRes.json().catch(() => ({}));
    console.log(`[vps-proxy] Edge Function fallback result:`, JSON.stringify(efData));

    return new Response(JSON.stringify({ ...efData, via: 'edge-function-fallback' }), {
      status: efRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[vps-proxy] Error:', err);
    return new Response(JSON.stringify({ error: String(err), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
