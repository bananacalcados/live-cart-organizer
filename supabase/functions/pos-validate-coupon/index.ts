// Validates referral (INDICA-XXX) and cashback (internal_cashback) coupons for POS use.
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

    const { coupon_code, subtotal } = await req.json();
    if (!coupon_code) {
      return new Response(JSON.stringify({ valid: false, error: 'coupon_code obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const code = String(coupon_code).trim().toUpperCase();
    const sub = Number(subtotal) || 0;

    // 1) Referral coupon (INDICA-XXXXX)
    if (code.startsWith('INDICA')) {
      const { data: ref } = await supabase
        .from('referrals')
        .select('id, friend_name, coupon_value, coupon_expires_at, coupon_redeemed_at')
        .eq('coupon_code', code)
        .maybeSingle();

      if (!ref) return ok({ valid: false, error: 'Cupom não encontrado' });
      if (ref.coupon_redeemed_at) return ok({ valid: false, error: 'Cupom já utilizado' });
      if (new Date(ref.coupon_expires_at) < new Date()) return ok({ valid: false, error: 'Cupom expirado' });
      if (sub < 80) return ok({ valid: false, error: 'Compra mínima de R$ 80,00 para usar cupom INDICA' });

      return ok({
        valid: true,
        type: 'referral',
        discount: Number(ref.coupon_value),
        label: `Indicação de ${ref.friend_name || 'amigo'}`,
        coupon_code: code,
        ref_id: ref.id,
      });
    }

    // 2) Internal cashback (any other code)
    const { data: cb } = await supabase
      .from('internal_cashback')
      .select('id, customer_name, cashback_amount, min_purchase, expires_at, is_used')
      .eq('coupon_code', code)
      .maybeSingle();

    if (!cb) return ok({ valid: false, error: 'Cupom não encontrado' });
    if (cb.is_used) return ok({ valid: false, error: 'Cashback já utilizado' });
    if (new Date(cb.expires_at) < new Date()) return ok({ valid: false, error: 'Cashback expirado' });
    if (sub < Number(cb.min_purchase || 0)) {
      return ok({ valid: false, error: `Compra mínima de R$ ${Number(cb.min_purchase).toFixed(2)} para este cashback` });
    }

    return ok({
      valid: true,
      type: 'cashback',
      discount: Number(cb.cashback_amount),
      label: `Cashback ${cb.customer_name || ''}`.trim(),
      coupon_code: code,
      cashback_id: cb.id,
    });
  } catch (e) {
    return new Response(JSON.stringify({ valid: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

function ok(payload: any) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
