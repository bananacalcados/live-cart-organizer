// Called from WhatsApp webhooks to detect referral signals in incoming messages.
// Detects: 1) coupon code INDICA-XXXXX in text  2) phone match with pending referral
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const COUPON_RX = /\bINDICA[A-Z0-9]{5}\b/i;

function suffix8(p: string) {
  return (p || '').replace(/\D/g, '').slice(-8);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { from_phone, message_text } = await req.json();
    if (!from_phone) {
      return new Response(JSON.stringify({ matched: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const text = (message_text || '').toString();
    const codeMatch = text.match(COUPON_RX);
    let referralId: string | null = null;
    let matchType: 'coupon' | 'phone' | null = null;

    if (codeMatch) {
      const code = codeMatch[0].toUpperCase();
      const { data } = await supabase
        .from('referrals')
        .select('id, status')
        .eq('coupon_code', code)
        .maybeSingle();
      if (data) {
        referralId = data.id;
        matchType = 'coupon';
      }
    }

    if (!referralId) {
      const sfx = suffix8(from_phone);
      if (sfx.length === 8) {
        const { data } = await supabase
          .from('referrals')
          .select('id, friend_phone, status')
          .ilike('friend_phone', `%${sfx}`)
          .is('friend_contacted_at', null)
          .order('created_at', { ascending: false })
          .limit(1);
        if (data && data.length > 0) {
          referralId = data[0].id;
          matchType = 'phone';
        }
      }
    }

    if (referralId) {
      await supabase.from('referrals').update({
        friend_contacted_at: new Date().toISOString(),
        status: 'contacted',
      }).eq('id', referralId).is('friend_contacted_at', null);
    }

    return new Response(JSON.stringify({ matched: !!referralId, referral_id: referralId, match_type: matchType }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ matched: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
