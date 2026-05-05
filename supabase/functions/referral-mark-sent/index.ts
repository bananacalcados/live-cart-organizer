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

    const { referral_id } = await req.json();
    if (!referral_id) {
      return new Response(JSON.stringify({ error: 'referral_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data, error } = await supabase
      .from('referrals')
      .update({ message_sent_at: new Date().toISOString(), status: 'sent' })
      .eq('id', referral_id)
      .is('message_sent_at', null)
      .select()
      .maybeSingle();

    if (error) throw error;

    // Check if cashback was doubled (trigger does it). Get token state to inform UI.
    let doubled = false;
    let cashback_value: number | null = null;
    if (data) {
      const { data: tok } = await supabase
        .from('review_tokens')
        .select('cashback_doubled, cashback_value, customer_phone, customer_name, store_phone')
        .eq('id', data.review_token_id)
        .single();
      if (tok) {
        doubled = !!tok.cashback_doubled;
        cashback_value = tok.cashback_value;

        // If just doubled, notify via WhatsApp template (best-effort)
        if (doubled && tok.customer_phone) {
          try {
            await supabase.functions.invoke('meta-whatsapp-send-text', {
              body: {
                phone: tok.customer_phone,
                message: `🎉 Parabéns! Você indicou 3 amigos e *seu cashback foi DOBRADO* para *R$ ${Number(tok.cashback_value).toFixed(2).replace('.', ',')}*. Use na sua próxima compra no Banana Calçados.`,
              },
            });
          } catch (_) { /* ignore */ }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, doubled, cashback_value }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
