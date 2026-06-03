import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { payload, whatsapp_number_id, webhook_url } = await req.json();
    if (!payload || typeof payload !== 'object') {
      return new Response(JSON.stringify({ error: 'payload required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let whatsapp = { zapi_instance_id: '', zapi_token: '', zapi_client_token: '' };
    if (whatsapp_number_id) {
      const { data: num } = await supabase
        .from('whatsapp_numbers')
        .select('zapi_instance_id, zapi_token, zapi_client_token')
        .eq('id', whatsapp_number_id)
        .maybeSingle();
      if (num) {
        whatsapp = {
          zapi_instance_id: (num as any).zapi_instance_id || '',
          zapi_token: (num as any).zapi_token || '',
          zapi_client_token: (num as any).zapi_client_token || '',
        };
      }
    }

    const url = webhook_url || 'https://api.bananacalcados.com.br/webhook/novo-pedido';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, whatsapp }),
    });
    const body = await resp.text();

    return new Response(JSON.stringify({ ok: resp.ok, status: resp.status, body }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
