import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { phone, sellerId, storeId, whatsappNumberId, finishConversationId } = await req.json();

    if (!phone) {
      return new Response(JSON.stringify({ error: 'phone required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if NPS was already sent recently (last 7 days) to avoid spam
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: recent } = await supabase
      .from('chat_nps_surveys')
      .select('id')
      .eq('phone', phone)
      .gte('sent_at', sevenDaysAgo.toISOString())
      .limit(1);

    if (recent && recent.length > 0) {
      console.log(`[nps] Skipping ${phone} - NPS sent recently`);
      return new Response(JSON.stringify({ skipped: true, reason: 'recent_nps' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create NPS survey record
    const { data: survey, error: insertErr } = await supabase
      .from('chat_nps_surveys')
      .insert({
        phone,
        seller_id: sellerId || null,
        store_id: storeId || null,
        whatsapp_number_id: whatsappNumberId || null,
        finish_conversation_id: finishConversationId || null,
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;

    // Send NPS message via WhatsApp
    const message = `Olá! 😊 Obrigado pela sua compra! 🛍️\n\nGostaríamos de saber: de 0 a 10, o quanto você recomendaria nosso atendimento?\n\nResponda com um número de 0 a 10.\n\n⭐ Sua opinião é muito importante para nós!`;

    if (whatsappNumberId) {
      await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message, whatsappNumberId }),
      });
    } else {
      await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message, whatsapp_number_id: whatsappNumberId }),
      });
    }

    // Save message
    await supabase.from('whatsapp_messages').insert({
      phone,
      message,
      direction: 'outgoing',
      status: 'sent',
      whatsapp_number_id: whatsappNumberId || null,
    });

    console.log(`[nps] NPS sent to ${phone}, survey id: ${survey.id}`);

    return new Response(JSON.stringify({ success: true, surveyId: survey.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[nps] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
