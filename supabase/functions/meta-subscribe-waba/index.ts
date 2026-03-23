import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const accessToken = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')!;

  // WABAs to subscribe
  const wabaIds = [
    { id: '124036876111264', label: 'Centro' },
    { id: '129700141901757', label: 'Pérola' },
    { id: '1250450643617667', label: 'Banana Online' },
  ];

  const results: any[] = [];

  for (const waba of wabaIds) {
    // First check current subscriptions
    const checkRes = await fetch(
      `https://graph.facebook.com/v21.0/${waba.id}/subscribed_apps`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const checkData = await checkRes.json();

    // Subscribe the app to this WABA
    const subRes = await fetch(
      `https://graph.facebook.com/v21.0/${waba.id}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const subData = await subRes.json();

    results.push({
      waba: waba.label,
      wabaId: waba.id,
      currentSubscriptions: checkData,
      subscribeResult: subData,
      subscribeStatus: subRes.status,
    });
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
