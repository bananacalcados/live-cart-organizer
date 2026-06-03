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

    const { token } = await req.json();
    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({ error: 'token required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: tok } = await supabase
      .from('review_tokens')
      .select('id, customer_phone, customer_name, store_phone, cashback_value, cashback_doubled, review_submitted_at')
      .eq('token', token)
      .maybeSingle();

    if (!tok) {
      return new Response(JSON.stringify({ token: null, referrals: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: refs } = await supabase
      .from('referrals')
      .select('id, friend_name, friend_phone, coupon_code, coupon_value, message_sent_at')
      .eq('review_token_id', tok.id)
      .order('created_at');

    return new Response(JSON.stringify({ token: tok, referrals: refs || [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
