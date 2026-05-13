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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { phone, customer_name, store_id, store_phone, cashback_value, sale_value, whatsapp_number_id } = await req.json();
    if (!phone) {
      return new Response(JSON.stringify({ error: 'phone required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Auto-calculate cashback from sale_value using pos_cashback_config when not provided
    let finalCashback = Number(cashback_value) || 0;
    if (!finalCashback && Number(sale_value) > 0) {
      const { data: cfg } = await supabase
        .from('pos_cashback_config')
        .select('is_enabled, percentage, min_sale_value, max_cashback')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cfg && (cfg as any).is_enabled && Number(sale_value) >= Number((cfg as any).min_sale_value || 0)) {
        const pct = Number((cfg as any).percentage) || 0;
        let calc = Number(sale_value) * pct / 100;
        const maxCb = Number((cfg as any).max_cashback);
        if (maxCb > 0 && calc > maxCb) calc = maxCb;
        finalCashback = Math.round(calc * 100) / 100;
      }
    }

    // Generate token
    let token = genToken();
    for (let i = 0; i < 3; i++) {
      const { data } = await supabase.from('review_tokens').select('id').eq('token', token).maybeSingle();
      if (!data) break;
      token = genToken();
    }

    const { data: tok, error } = await supabase
      .from('review_tokens')
      .insert({
        token,
        customer_phone: phone,
        customer_name: customer_name || null,
        store_id: store_id || null,
        store_phone: store_phone || null,
        cashback_value: finalCashback,
      })
      .select('id, token, cashback_value')
      .single();
    if (error) throw error;

    const url = `https://checkout.bananacalcados.com.br/r/${tok.token}`;
    const cashbackTxt = `R$ ${Number(tok.cashback_value).toFixed(2).replace('.', ',')}`;
    const message =
      `Olá${customer_name ? `, ${customer_name}` : ''}! 💛 Obrigada pela sua compra na *Banana Calçados*!\n\n` +
      `Sua opinião vale muito pra gente. Dá uma nota rapidinha aqui 👇\n${url}\n\n` +
      `✨ E temos uma surpresa: você tem *${cashbackTxt} de cashback* — e indicando 3 amigos seu cashback *DOBRA*! 🎁`;

    // Try Meta first if whatsapp_number_id, else Z-API
    try {
      if (whatsapp_number_id) {
        await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, message, whatsappNumberId: whatsapp_number_id }),
        });
      } else {
        await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, message, whatsapp_number_id }),
        });
      }
    } catch (e) {
      console.error('[review-send-link] send failed', e);
    }

    await supabase.from('whatsapp_messages').insert({
      phone, message, direction: 'outgoing', status: 'sent',
      whatsapp_number_id: whatsapp_number_id || null,
    });

    return new Response(JSON.stringify({ success: true, token: tok.token, url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
