import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const accessToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN');
    const phoneIds = ['1045345955328710', '955632114310880'];
    const results: Record<string, unknown> = {};
    for (const pid of phoneIds) {
      const resp = await fetch(`https://graph.facebook.com/v21.0/${pid}?fields=display_phone_number,verified_name,quality_rating&access_token=${accessToken}`);
      results[pid] = await resp.json();
    }
    return new Response(JSON.stringify({ results }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
