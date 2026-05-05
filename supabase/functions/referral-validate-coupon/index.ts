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

    const { coupon_code, redeem, sale_id, friend_phone } = await req.json();
    if (!coupon_code) {
      return new Response(JSON.stringify({ valid: false, error: 'coupon_code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const code = String(coupon_code).trim().toUpperCase();
    const { data: ref } = await supabase
      .from('referrals')
      .select('id, friend_name, friend_phone, coupon_value, coupon_expires_at, coupon_redeemed_at, status')
      .eq('coupon_code', code)
      .maybeSingle();

    if (!ref) {
      return new Response(JSON.stringify({ valid: false, error: 'cupom_nao_encontrado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (ref.coupon_redeemed_at) {
      return new Response(JSON.stringify({ valid: false, error: 'cupom_ja_usado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (new Date(ref.coupon_expires_at) < new Date()) {
      return new Response(JSON.stringify({ valid: false, error: 'cupom_expirado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (redeem) {
      await supabase.from('referrals').update({
        coupon_redeemed_at: new Date().toISOString(),
        redeemed_in_sale_id: sale_id || null,
        friend_contacted_at: ref.status === 'pending' ? new Date().toISOString() : undefined,
        status: 'redeemed',
        friend_phone: friend_phone || ref.friend_phone,
      }).eq('id', ref.id);
    }

    return new Response(JSON.stringify({
      valid: true,
      discount: Number(ref.coupon_value),
      friend_name: ref.friend_name,
      coupon_code: code,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ valid: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
