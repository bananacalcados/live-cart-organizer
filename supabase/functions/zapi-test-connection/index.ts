import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { instance_id, token, client_token } = await req.json();

    if (!instance_id || !token || !client_token) {
      return new Response(
        JSON.stringify({ error: 'Missing credentials', connected: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const zapiUrl = `https://api.z-api.io/instances/${instance_id}/token/${token}/status`;
    const response = await fetch(zapiUrl, {
      method: 'GET',
      headers: { 'Client-Token': client_token },
    });

    const data = await response.json();
    console.log('Z-API status response:', data);

    const connected = data?.connected === true || data?.smartphoneConnected === true;

    return new Response(
      JSON.stringify({ connected, smartphoneConnected: data?.smartphoneConnected, details: data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error testing connection:', error);
    return new Response(
      JSON.stringify({ error: error.message, connected: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
