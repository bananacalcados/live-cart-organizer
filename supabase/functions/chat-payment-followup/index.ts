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

    // Find active followups where next_reminder_at <= now
    const { data: followups } = await supabase
      .from('chat_payment_followups')
      .select('*')
      .eq('is_active', true)
      .lte('next_reminder_at', new Date().toISOString())
      .order('next_reminder_at');

    if (!followups || followups.length === 0) {
      return new Response(JSON.stringify({ message: 'No pending followups', count: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[followup] Processing ${followups.length} pending followups`);
    let sent = 0;

    for (const fu of followups) {
      // Check if payment was already made (not in awaiting_payment anymore)
      const { data: awp } = await supabase
        .from('chat_awaiting_payment')
        .select('id')
        .eq('phone', fu.phone)
        .maybeSingle();

      if (!awp) {
        // Payment was confirmed, deactivate followup
        await supabase.from('chat_payment_followups').update({
          is_active: false,
          completed_at: new Date().toISOString(),
        }).eq('id', fu.id);
        console.log(`[followup] ${fu.phone} already paid, deactivated`);
        continue;
      }

      // Check if max reminders reached
      if (fu.reminder_count >= fu.max_reminders) {
        await supabase.from('chat_payment_followups').update({
          is_active: false,
          completed_at: new Date().toISOString(),
        }).eq('id', fu.id);
        console.log(`[followup] ${fu.phone} max reminders reached`);
        continue;
      }

      // Send reminder message
      const reminderNum = fu.reminder_count + 1;
      const messages = [
        `Olá! 😊 Vi que seu link de pagamento ainda está pendente. Precisa de ajuda para finalizar? Estou aqui!`,
        `Oi! Passando pra lembrar do seu pedido 🛍️ O link ainda está ativo, é só clicar para concluir. Qualquer dúvida, estou à disposição!`,
        `Olá! Último aviso sobre seu pedido pendente ⏰ Se tiver alguma dificuldade com o pagamento, me avise que ajudo! 😊`,
      ];
      const message = messages[Math.min(reminderNum - 1, messages.length - 1)];

      // Determine send method
      const sendNumberId = fu.whatsapp_number_id;
      
      if (sendNumberId) {
        await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: fu.phone, message, whatsappNumberId: sendNumberId }),
        });
      } else {
        await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: fu.phone, message }),
        });
      }

      // Save message to DB
      await supabase.from('whatsapp_messages').insert({
        phone: fu.phone,
        message,
        direction: 'outgoing',
        status: 'sent',
        whatsapp_number_id: sendNumberId || null,
      });

      // Update followup
      const nextReminder = new Date();
      nextReminder.setMinutes(nextReminder.getMinutes() + fu.interval_minutes);
      
      await supabase.from('chat_payment_followups').update({
        reminder_count: reminderNum,
        next_reminder_at: nextReminder.toISOString(),
      }).eq('id', fu.id);

      sent++;
      console.log(`[followup] Sent reminder ${reminderNum}/${fu.max_reminders} to ${fu.phone}`);
      
      // Small delay between sends
      await new Promise(r => setTimeout(r, 1000));
    }

    return new Response(JSON.stringify({ success: true, processed: followups.length, sent }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[followup] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
