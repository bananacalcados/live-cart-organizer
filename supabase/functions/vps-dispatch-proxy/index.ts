import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const VPS_URL = 'http://31.97.23.119:3333';
const VPS_SECRET = 'banana2025dispatcher';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dispatch_id, action } = await req.json();

    if (!dispatch_id) {
      return new Response(JSON.stringify({ error: 'dispatch_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const endpoint = action === 'status' ? `/status/${dispatch_id}` : '/dispatch';
    const method = action === 'status' ? 'GET' : 'POST';

    const fetchOptions: RequestInit = { method };
    if (method === 'POST') {
      fetchOptions.headers = { 'Content-Type': 'application/json' };
      fetchOptions.body = JSON.stringify({ dispatch_id, secret: VPS_SECRET });
    }

    console.log(`[vps-proxy] ${method} ${VPS_URL}${endpoint}`);

    const res = await fetch(`${VPS_URL}${endpoint}`, fetchOptions);
    const data = await res.json();

    console.log(`[vps-proxy] Response:`, JSON.stringify(data));

    return new Response(JSON.stringify(data), {
      status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[vps-proxy] Error:', err);
    return new Response(JSON.stringify({ error: String(err), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
