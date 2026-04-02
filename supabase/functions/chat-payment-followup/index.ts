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

    // ── PART 1: Abandoned checkout detection ──
    // Find orders where checkout was opened (checkout_started_at set) but not paid,
    // only from last 48h and at least 10min ago
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: abandonedOrders } = await supabase
      .from('orders')
      .select('id, customer_id, checkout_started_at, cart_link')
      .eq('is_paid', false)
      .not('checkout_started_at', 'is', null)
      .lte('checkout_started_at', tenMinAgo)
      .gte('checkout_started_at', twoDaysAgo)
      .order('checkout_started_at', { ascending: false })
      .limit(50);

    // Get all phones that already received checkout_abandonado in last 24h
    const { data: recentAbandoned } = await supabase
      .from('chat_payment_followups')
      .select('phone')
      .eq('type', 'checkout_abandonado')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    
    const alreadySentPhones = new Set(
      (recentAbandoned || []).map((r: any) => r.phone?.replace(/\D/g, '').slice(-8))
    );

    let abandonedSent = 0;
    if (abandonedOrders?.length) {
      for (const order of abandonedOrders) {
        // Get customer phone
        const { data: customer } = await supabase
          .from('customers')
          .select('whatsapp')
          .eq('id', order.customer_id)
          .maybeSingle();

        if (!customer?.whatsapp) continue;
        const phone = customer.whatsapp;
        const phoneSuffix = phone.replace(/\D/g, '').slice(-8);

        // Check if we already sent for this phone suffix
        if (alreadySentPhones.has(phoneSuffix)) continue;
        alreadySentPhones.add(phoneSuffix); // prevent duplicates within same batch

        // Check if already paid via other means
        if (order.customer_id) {
          const { data: paidOrder } = await supabase
            .from('orders')
            .select('id')
            .eq('customer_id', order.customer_id)
            .eq('is_paid', true)
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle();
          if (paidOrder) continue;
        }

        // Try to get campaign-specific prompt for checkout_abandonado
        let message = `Oi! 😊 Vi que você abriu o link do seu pedido mas não finalizou. Aconteceu algum problema? Posso te ajudar com qualquer dúvida!`;

        // Look for ad_lead to find campaign_id and whatsapp_number_id
        const phoneSuffix = phone.replace(/\D/g, '').slice(-8);
        const { data: adLead } = await supabase
          .from('ad_leads')
          .select('campaign_id, whatsapp_number_id')
          .ilike('phone', `%${phoneSuffix}`)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const sendNumberId = adLead?.whatsapp_number_id || null;

        if (adLead?.campaign_id) {
          // Try campaign-specific prompt
          const { data: prompt } = await supabase
            .from('ad_campaign_situation_prompts')
            .select('prompt_text')
            .eq('campaign_id', adLead.campaign_id)
            .eq('situation', 'checkout_abandonado')
            .eq('is_active', true)
            .maybeSingle();

          if (!prompt) {
            // Fallback to global prompt
            const { data: globalPrompt } = await supabase
              .from('ad_campaign_situation_prompts')
              .select('prompt_text')
              .is('campaign_id', null)
              .eq('situation', 'checkout_abandonado')
              .eq('is_active', true)
              .maybeSingle();

            if (globalPrompt?.prompt_text) {
              message = globalPrompt.prompt_text;
            }
          } else if (prompt.prompt_text) {
            message = prompt.prompt_text;
          }
        }

        // Send message
        if (sendNumberId) {
          await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, message, whatsappNumberId: sendNumberId }),
          });
        } else {
          await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, message }),
          });
        }

        // Save message
        await supabase.from('whatsapp_messages').insert({
          phone, message, direction: 'outgoing', status: 'sent',
          whatsapp_number_id: sendNumberId,
        });

        // Create followup record to prevent duplicates
        await supabase.from('chat_payment_followups').insert({
          phone,
          type: 'checkout_abandonado',
          is_active: false,
          reminder_count: 1,
          max_reminders: 1,
          completed_at: new Date().toISOString(),
          whatsapp_number_id: sendNumberId,
        });

        abandonedSent++;
        console.log(`[followup] Checkout abandonado detected for ${phone}, sent message`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // ── PART 2: Regular payment followups ──
    const { data: followups } = await supabase
      .from('chat_payment_followups')
      .select('*')
      .eq('is_active', true)
      .lte('next_reminder_at', new Date().toISOString())
      .order('next_reminder_at');

    if (!followups || followups.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'Processed', abandonedSent, regularSent: 0 
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[followup] Processing ${followups.length} pending followups`);
    let sent = 0;

    for (const fu of followups) {
      // Check if payment was already made
      let isPaid = false;
      if (fu.sale_id) {
        const { data: sale } = await supabase
          .from('pos_sales')
          .select('status')
          .eq('id', fu.sale_id)
          .maybeSingle();
        if (sale?.status === 'completed' || sale?.status === 'paid') isPaid = true;
      }

      // Verificar na tabela orders via customers.whatsapp
      if (!isPaid && fu.phone) {
        const phoneSuffix = fu.phone.replace(/\D/g, '').slice(-8);
        if (phoneSuffix.length >= 8) {
          const { data: customers } = await supabase
            .from('customers')
            .select('id')
            .ilike('whatsapp', `%${phoneSuffix}`)
            .limit(5);

          if (customers?.length) {
            const customerIds = customers.map((c: any) => c.id);
            const { data: liveOrder } = await supabase
              .from('orders')
              .select('id, is_paid')
              .in('customer_id', customerIds)
              .eq('is_paid', true)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (liveOrder?.is_paid) isPaid = true;
          }
        }
      }

      const { data: awp } = await supabase
        .from('chat_awaiting_payment')
        .select('id')
        .eq('phone', fu.phone)
        .maybeSingle();

      if (isPaid || !awp) {
        if (awp) {
          await supabase.from('chat_awaiting_payment').delete().eq('id', awp.id);
        }
        await supabase.from('chat_payment_followups').update({
          is_active: false,
          completed_at: new Date().toISOString(),
        }).eq('id', fu.id);
        console.log(`[followup] ${fu.phone} completed (paid=${isPaid}), deactivated`);
        continue;
      }

      if (fu.reminder_count >= fu.max_reminders) {
        await supabase.from('chat_payment_followups').update({
          is_active: false,
          completed_at: new Date().toISOString(),
        }).eq('id', fu.id);
        console.log(`[followup] ${fu.phone} max reminders reached`);
        continue;
      }

      // Check if checkout was opened — use contextual message
      let checkoutOpened = false;
      if (fu.phone) {
        const phoneSuffix = fu.phone.replace(/\D/g, '').slice(-8);
        const { data: customers } = await supabase
          .from('customers')
          .select('id')
          .ilike('whatsapp', `%${phoneSuffix}`)
          .limit(5);

        if (customers?.length) {
          const customerIds = customers.map((c: any) => c.id);
          const { data: openedOrder } = await supabase
            .from('orders')
            .select('id, checkout_started_at')
            .in('customer_id', customerIds)
            .eq('is_paid', false)
            .not('checkout_started_at', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (openedOrder?.checkout_started_at) checkoutOpened = true;
        }
      }

      const reminderNum = fu.reminder_count + 1;

      // Messages with checkout-aware variants
      const standardMessages = [
        `Olá! 😊 Vi que seu link de pagamento ainda está pendente. Precisa de ajuda para finalizar? Estou aqui!`,
        `Oi! Passando pra lembrar do seu pedido 🛍️ O link ainda está ativo, é só clicar para concluir. Qualquer dúvida, estou à disposição!`,
        `Olá! Último aviso sobre seu pedido pendente ⏰ Se tiver alguma dificuldade com o pagamento, me avise que ajudo! 😊`,
      ];

      const checkoutOpenedMessages = [
        `Oi! 😊 Vi que você abriu o link do pedido mas não finalizou. Teve alguma dificuldade? Estou aqui pra te ajudar!`,
        `Ei! Notei que você chegou a acessar o checkout 🛒 Se precisar de ajuda com alguma etapa do pagamento, é só me chamar!`,
        `Olá! Percebi que você acessou o link mas não concluiu ⏰ Posso te ajudar com alguma dúvida sobre o pagamento?`,
      ];

      const messagePool = checkoutOpened ? checkoutOpenedMessages : standardMessages;
      const message = messagePool[Math.min(reminderNum - 1, messagePool.length - 1)];

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

      await supabase.from('whatsapp_messages').insert({
        phone: fu.phone, message, direction: 'outgoing', status: 'sent',
        whatsapp_number_id: sendNumberId || null,
      });

      // Escalating intervals: 1st→2nd: 30min, 2nd→3rd: 2h
      const intervalMap: Record<number, number> = { 1: 30, 2: 120, 3: 120 };
      const nextInterval = intervalMap[reminderNum] || fu.interval_minutes;
      const nextReminder = new Date();
      nextReminder.setMinutes(nextReminder.getMinutes() + nextInterval);

      await supabase.from('chat_payment_followups').update({
        reminder_count: reminderNum,
        next_reminder_at: nextReminder.toISOString(),
      }).eq('id', fu.id);

      sent++;
      console.log(`[followup] Sent reminder ${reminderNum}/${fu.max_reminders} to ${fu.phone} (checkoutOpened=${checkoutOpened})`);
      await new Promise(r => setTimeout(r, 1000));
    }

    // ── PART 3: Scheduled followups (personalized date/time) ──
    const { data: scheduledItems } = await supabase
      .from('chat_scheduled_followups')
      .select('*')
      .eq('is_sent', false)
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at')
      .limit(50);

    let scheduledSent = 0;
    if (scheduledItems?.length) {
      for (const item of scheduledItems) {
        // Build contextual message based on reason/situation_hint
        let message = `Oi! 😊 Passando aqui como combinamos. `;
        
        if (item.situation_hint === 'objecao_financeira') {
          message += `Lembra que você mencionou que ia verificar sobre o pagamento? Conseguiu resolver? Estou aqui pra te ajudar! 💳`;
        } else if (item.situation_hint === 'objecao_consulta') {
          message += `Conseguiu conversar sobre aquele produto que te mostrei? Se tiver alguma dúvida, estou à disposição! 😊`;
        } else if (item.reason) {
          message += item.reason;
        } else {
          message += `Tudo bem por aí? Ainda posso te ajudar com aquele pedido! 🛍️`;
        }

        // Try to get campaign-specific prompt
        if (item.campaign_id) {
          const situationKey = item.situation_hint || 'followup_1';
          const { data: prompt } = await supabase
            .from('ad_campaign_situation_prompts')
            .select('prompt_text')
            .eq('campaign_id', item.campaign_id)
            .eq('situation', situationKey)
            .eq('is_active', true)
            .maybeSingle();

          // Campaign prompt is instructional, so we keep the default contextual message
          // but log the prompt for AI context if needed
        }

        const sendNumberId = item.whatsapp_number_id;

        if (sendNumberId) {
          await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: item.phone, message, whatsappNumberId: sendNumberId }),
          });
        } else {
          await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: item.phone, message }),
          });
        }

        await supabase.from('whatsapp_messages').insert({
          phone: item.phone, message, direction: 'outgoing', status: 'sent',
          whatsapp_number_id: sendNumberId || null,
        });

        await supabase.from('chat_scheduled_followups').update({
          is_sent: true,
          sent_at: new Date().toISOString(),
        }).eq('id', item.id);

        scheduledSent++;
        console.log(`[followup] Scheduled followup sent to ${item.phone} (reason: ${item.situation_hint || item.reason})`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return new Response(JSON.stringify({ success: true, processed: followups?.length || 0, sent, abandonedSent, scheduledSent }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[followup] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
