import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function genCoupon() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'INDICA';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function normalizePhone(p: string): string {
  let d = (p || '').replace(/\D/g, '');
  if (d.length === 10) {
    // Add 9th digit after DDD
    d = d.slice(0, 2) + '9' + d.slice(2);
  }
  if (!d.startsWith('55')) d = '55' + d;
  return d;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { token, friend_name, friend_phone } = await req.json();
    if (!token || !friend_name || !friend_phone) {
      return new Response(JSON.stringify({ error: 'token, friend_name, friend_phone required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: tok } = await supabase
      .from('review_tokens')
      .select('id, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (!tok) {
      return new Response(JSON.stringify({ error: 'invalid token' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Limit 3 referrals per token
    const { count } = await supabase
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('review_token_id', tok.id);

    if ((count || 0) >= 3) {
      return new Response(JSON.stringify({ error: 'limit_reached', max: 3 }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let coupon = genCoupon();
    for (let i = 0; i < 3; i++) {
      const { data } = await supabase.from('referrals').select('id').eq('coupon_code', coupon).maybeSingle();
      if (!data) break;
      coupon = genCoupon();
    }

    const phone = normalizePhone(friend_phone);

    const { data, error } = await supabase
      .from('referrals')
      .insert({
        review_token_id: tok.id,
        friend_name: friend_name.trim().slice(0, 100),
        friend_phone: phone,
        coupon_code: coupon,
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, referral: data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
