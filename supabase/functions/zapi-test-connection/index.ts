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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    // ---- Auth: somente admin pode testar ----
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '').trim();
    if (!jwt) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', connected: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', connected: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: isAdmin } = await admin.rpc('has_role', {
      _user_id: userData.user.id,
      _role: 'admin',
    });
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Forbidden', connected: false }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ---- Resolve credenciais (server-side, nunca trafegam pelo navegador) ----
    const body = await req.json().catch(() => ({}));
    const { number_id } = body ?? {};

    if (!number_id) {
      return new Response(
        JSON.stringify({ error: 'Missing number_id', connected: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: row, error: rowErr } = await admin
      .from('whatsapp_numbers')
      .select('zapi_instance_id, zapi_token, zapi_client_token')
      .eq('id', number_id)
      .eq('provider', 'zapi')
      .maybeSingle();

    if (rowErr || !row?.zapi_instance_id || !row?.zapi_token || !row?.zapi_client_token) {
      return new Response(
        JSON.stringify({ error: 'Credentials not found', connected: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const zapiUrl = `https://api.z-api.io/instances/${row.zapi_instance_id}/token/${row.zapi_token}/status`;
    const response = await fetch(zapiUrl, {
      method: 'GET',
      headers: { 'Client-Token': row.zapi_client_token },
    });

    const data = await response.json();
    const connected = data?.connected === true || data?.smartphoneConnected === true;

    return new Response(
      JSON.stringify({ connected, smartphoneConnected: data?.smartphoneConnected }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error testing connection:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, connected: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
