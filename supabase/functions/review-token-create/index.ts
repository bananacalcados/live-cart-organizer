import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function genToken(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const { customer_phone, customer_name, store_id, store_phone, cashback_value, customer_zoppy_id } = body;

    if (!customer_phone) {
      return new Response(JSON.stringify({ error: 'customer_phone required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let token = genToken();
    // Avoid collision (extremely unlikely but safe)
    for (let i = 0; i < 3; i++) {
      const { data } = await supabase.from('review_tokens').select('id').eq('token', token).maybeSingle();
      if (!data) break;
      token = genToken();
    }

    const { data, error } = await supabase
      .from('review_tokens')
      .insert({
        token,
        customer_phone,
        customer_name: customer_name || null,
        store_id: store_id || null,
        store_phone: store_phone || null,
        cashback_value: cashback_value || 0,
        customer_zoppy_id: customer_zoppy_id || null,
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, token: data.token, id: data.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
