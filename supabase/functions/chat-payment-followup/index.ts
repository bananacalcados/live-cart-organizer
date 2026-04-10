import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Check if current time is within business hours (8h-18h BRT / UTC-3) */
function isBusinessHours(): boolean {
  const now = new Date();
  const brtHour = new Date(now.getTime() - 3 * 60 * 60 * 1000).getUTCHours();
  return brtHour >= 8 && brtHour < 18;
}

/** Get next business hour start (8h BRT) as ISO string */
function getNextBusinessStart(): string {
  const now = new Date();
  const brtNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const brtHour = brtNow.getUTCHours();
  
  const next = new Date(now);
  if (brtHour >= 18) {
    // After 18h BRT → next day 8h BRT
    next.setUTCDate(next.getUTCDate() + 1);
  }
  // Set to 8h BRT = 11h UTC
  next.setUTCHours(11, 0, 0, 0);
  return next.toISOString();
}

/** Random delay between min and max ms to appear human-like */
function humanDelay(minMs = 5000, maxMs = 15000): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise(r => setTimeout(r, delay));
}

/** Check if an order is truly paid (is_paid OR stage in paid states) */
async function isOrderPaid(supabase: any, orderId: string): Promise<boolean> {
  const { data } = await supabase.rpc('check_order_paid', { p_order_id: orderId });
  return data === true;
}

/** Check if ANY order for this customer is paid recently */
async function hasCustomerPaidRecently(supabase: any, customerId: string): Promise<boolean> {
  // Check is_paid = true
  const { data: paidOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customerId)
    .eq('is_paid', true)
    .limit(1)
    .maybeSingle();
  if (paidOrder) return true;

  // Check stage-based payment
  const { data: stageOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customerId)
    .in('stage', ['paid', 'concluido', 'pago', 'completed', 'shipped', 'delivered', 'enviado', 'entregue'])
    .limit(1)
    .maybeSingle();
  if (stageOrder) return true;

  return false;
}

/** Check if a human operator is actively chatting with this phone (outgoing msg in last 30min) */
async function isHumanActivelyChattingWith(supabase: any, phone: string): Promise<boolean> {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const normalizedPhone = phone.replace(/\D/g, '');
  
  // Check if there's an outgoing message from a human operator in last 48h
  // We detect "human" by checking outgoing messages that are NOT mass dispatches
  const { data: recentOutgoing } = await supabase
    .from('whatsapp_messages')
    .select('created_at')
    .eq('phone', normalizedPhone)
    .eq('direction', 'outgoing')
    .eq('is_mass_dispatch', false)
    .gte('created_at', fortyEightHoursAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!recentOutgoing) return false;

  // If there's also a recent incoming message → conversation is active
  const { data: recentIncoming } = await supabase
    .from('whatsapp_messages')
    .select('created_at')
    .eq('phone', normalizedPhone)
    .eq('direction', 'incoming')
    .gte('created_at', fortyEightHoursAgo)
    .limit(1)
    .maybeSingle();

  return !!recentIncoming;
}

/** Send message via appropriate channel with human-like behavior */
async function sendMessage(
  supabaseUrl: string, supabaseKey: string, supabase: any,
  phone: string, message: string, sendNumberId: string | null
): Promise<void> {
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
      body: JSON.stringify({ phone, message, whatsapp_number_id: sendNumberId }),
    });
  }

  await supabase.from('whatsapp_messages').insert({
    phone, message, direction: 'outgoing', status: 'sent',
    whatsapp_number_id: sendNumberId || null,
  });
}

// ── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── BUSINESS HOURS GATE ──
    // If outside business hours, reschedule any pending followups and exit
    if (!isBusinessHours()) {
      const nextStart = getNextBusinessStart();
      console.log(`[followup] Outside business hours (8h-18h BRT). Rescheduling to ${nextStart}`);

      // Reschedule active followups that were due now
      await supabase
        .from('chat_payment_followups')
        .update({ next_reminder_at: nextStart })
        .eq('is_active', true)
        .lte('next_reminder_at', new Date().toISOString());

      // Reschedule scheduled followups that were due now
      await supabase
        .from('chat_scheduled_followups')
        .update({ scheduled_at: nextStart })
        .eq('is_sent', false)
        .lte('scheduled_at', new Date().toISOString());

      return new Response(JSON.stringify({ 
        message: 'Outside business hours, rescheduled', nextStart 
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── PART 1: Abandoned checkout detection ──
    // ONLY for orders linked to ad_leads (keyword-initiated conversations)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: abandonedOrders } = await supabase
      .from('orders')
      .select('id, customer_id, checkout_started_at, cart_link, stage')
      .eq('is_paid', false)
      .not('checkout_started_at', 'is', null)
      .lte('checkout_started_at', tenMinAgo)
      .gte('checkout_started_at', twoDaysAgo)
      .order('checkout_started_at', { ascending: false })
      .limit(50);

    // Get phones that already received checkout_abandonado in last 24h
    const { data: recentAbandoned } = await supabase
      .from('chat_payment_followups')
      .select('phone')
      .eq('type', 'checkout_abandonado')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    
    const alreadySentPhones = new Set(
      (recentAbandoned || []).map((r: any) => r.phone?.replace(/\D/g, '').slice(-8))
    );

    let abandonedSent = 0;
    const MAX_SENDS_PER_RUN = 5; // Limit sends per execution to avoid bulk

    if (abandonedOrders?.length) {
      for (const order of abandonedOrders) {
        if (abandonedSent >= MAX_SENDS_PER_RUN) {
          console.log(`[followup] Max sends per run reached (${MAX_SENDS_PER_RUN}), stopping`);
          break;
        }

        // ── CRITICAL: Check stage-based payment too ──
        const paidStages = ['paid', 'concluido', 'pago', 'completed', 'shipped', 'delivered', 'enviado', 'entregue'];
        if (paidStages.includes(order.stage)) {
          console.log(`[followup] Order ${order.id} stage=${order.stage}, skipping (already paid/shipped)`);
          continue;
        }

        // Get customer phone
        const { data: customer } = await supabase
          .from('customers')
          .select('whatsapp')
          .eq('id', order.customer_id)
          .maybeSingle();

        if (!customer?.whatsapp) continue;
        const phone = customer.whatsapp;
        const pSuffix = phone.replace(/\D/g, '').slice(-8);

        if (alreadySentPhones.has(pSuffix)) continue;

        // ── Check if human operator is actively chatting ──
        const humanActive = await isHumanActivelyChattingWith(supabase, phone);
        if (humanActive) {
          console.log(`[followup] ${phone} has active human conversation, skipping checkout_abandonado`);
          continue;
        }

        // ── CRITICAL: Only follow up if this phone has an active ad_lead ──
        // This restricts followups to keyword-initiated conversations only
        const { data: adLead } = await supabase
          .from('ad_leads')
          .select('campaign_id, whatsapp_number_id')
          .ilike('phone', `%${pSuffix}`)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!adLead) {
          console.log(`[followup] No active ad_lead for ${phone}, skipping (not keyword-initiated)`);
          continue;
        }

        alreadySentPhones.add(pSuffix);

        // ── CRITICAL: Double-check payment with RPC (checks is_paid + stage) ──
        const orderPaid = await isOrderPaid(supabase, order.id);
        if (orderPaid) {
          console.log(`[followup] Order ${order.id} is paid (RPC), skipping`);
          continue;
        }

        // Also check if ANY order for this customer is paid
        if (order.customer_id) {
          const customerPaid = await hasCustomerPaidRecently(supabase, order.customer_id);
          if (customerPaid) {
            console.log(`[followup] Customer ${order.customer_id} has paid order, skipping`);
            continue;
          }
        }

        // Build message
        let message = `Oi! 😊 Vi que você abriu o link do seu pedido mas não finalizou. Aconteceu algum problema? Posso te ajudar com qualquer dúvida!`;
        const sendNumberId = adLead.whatsapp_number_id || null;

        if (adLead.campaign_id) {
          const { data: prompt } = await supabase
            .from('ad_campaign_situation_prompts')
            .select('prompt_text')
            .eq('campaign_id', adLead.campaign_id)
            .eq('situation', 'checkout_abandonado')
            .eq('is_active', true)
            .maybeSingle();

          if (prompt?.prompt_text) {
            message = prompt.prompt_text;
          } else {
            const { data: globalPrompt } = await supabase
              .from('ad_campaign_situation_prompts')
              .select('prompt_text')
              .is('campaign_id', null)
              .eq('situation', 'checkout_abandonado')
              .eq('is_active', true)
              .maybeSingle();
            if (globalPrompt?.prompt_text) message = globalPrompt.prompt_text;
          }
        }

        await sendMessage(supabaseUrl, supabaseKey, supabase, phone, message, sendNumberId);

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
        console.log(`[followup] Checkout abandonado for ${phone}, sent`);
        
        // Human-like delay between sends (5-15 seconds)
        await humanDelay();
      }
    }

    // ── PART 2: Regular payment followups ──
    const { data: followups } = await supabase
      .from('chat_payment_followups')
      .select('*')
      .eq('is_active', true)
      .lte('next_reminder_at', new Date().toISOString())
      .order('next_reminder_at')
      .limit(MAX_SENDS_PER_RUN);

    let sent = 0;
    if (followups?.length) {
      console.log(`[followup] Processing ${followups.length} pending followups`);

      for (const fu of followups) {
        if (sent + abandonedSent >= MAX_SENDS_PER_RUN) break;

        // ── Check if human operator is actively chatting ──
        const humanActiveChat = await isHumanActivelyChattingWith(supabase, fu.phone);
        if (humanActiveChat) {
          console.log(`[followup] ${fu.phone} has active human conversation, skipping followup`);
          continue;
        }

        let isPaid = false;
        if (fu.sale_id) {
          const { data: sale } = await supabase
            .from('pos_sales')
            .select('status')
            .eq('id', fu.sale_id)
            .maybeSingle();
          if (sale?.status === 'completed' || sale?.status === 'paid') isPaid = true;
        }

        // Check orders table via customer phone
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
              // Check both is_paid AND stage
              const { data: paidOrder } = await supabase
                .from('orders')
                .select('id, is_paid, stage')
                .in('customer_id', customerIds)
                .or('is_paid.eq.true,stage.in.(paid,concluido,pago,completed,shipped,delivered,enviado,entregue)')
                .limit(1)
                .maybeSingle();

              if (paidOrder) isPaid = true;
            }
          }
        }

        const isGeneralAdsFollowup = typeof fu.type === 'string' && fu.type.startsWith('ads_') && fu.type !== 'ads_checkout';

        const { data: awp } = await supabase
          .from('chat_awaiting_payment')
          .select('id')
          .eq('phone', fu.phone)
          .maybeSingle();

        if (isPaid || (!isGeneralAdsFollowup && !awp)) {
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

        const reminderNum = fu.reminder_count + 1;

        // Check if checkout was opened
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
              .limit(1)
              .maybeSingle();
            if (openedOrder?.checkout_started_at) checkoutOpened = true;
          }
        }

        // ── Stage-aware follow-up messages ──
        const stageFromType = (fu.type || '').replace('ads_', '');

        const stageMessages: Record<string, string[]> = {
          qualificacao: [
            `E então, quer que eu comece a montar seu pedido? 😊 Posso te ajudar a escolher o tamanho e a cor certinha!`,
            `Oi! Ainda tá de olho naquele produto? Me conta que te ajudo a escolher o melhor pra você! 🛍️`,
            `Olá! Vi que você se interessou pelos nossos produtos. Quer que eu te mostre as opções disponíveis? 😊`,
          ],
          duvidas: [
            `Oi! Consegui esclarecer sua dúvida? Se quiser, posso te ajudar a montar o pedido agora! 😊`,
            `E aí, ficou com mais alguma dúvida sobre o produto? Estou aqui pra te ajudar! 🛍️`,
            `Olá! Só passando pra saber se resolveu aquela dúvida. Posso te ajudar com mais alguma coisa? 😊`,
          ],
          coleta: [
            `Oi! Faltam só alguns dados pra gente finalizar seu pedido 😊 Quer continuar de onde paramos?`,
            `E aí, consegue me passar aqueles dados que faltam? Tô quase finalizando seu pedido! 🛍️`,
            `Olá! Seu pedido tá quase pronto, só preciso de mais algumas informações. Vamos concluir? 😊`,
          ],
          pagamento: [
            `Olá! 😊 Vi que seu link de pagamento ainda está pendente. Precisa de ajuda para finalizar? Estou aqui!`,
            `Oi! Passando pra lembrar do seu pedido 🛍️ O link ainda está ativo, é só clicar para concluir!`,
            `Último aviso sobre seu pedido pendente ⏰ Se tiver dificuldade com o pagamento, me avise! 😊`,
          ],
          followup_1: [
            `Oi! Passando aqui de novo 😊 Ainda tá pensando naquele produto? Posso te ajudar!`,
            `E aí, decidiu sobre o pedido? Qualquer dúvida estou aqui! 🛍️`,
          ],
          followup_2: [
            `Oi! Só passando pra avisar que ainda temos disponibilidade 😊 Quer que eu monte seu pedido?`,
            `Olá! Ainda posso te ajudar com aquele produto que você se interessou! 🛍️`,
          ],
        };

        const checkoutOpenedMessages = [
          `Oi! 😊 Vi que você abriu o link do pedido mas não finalizou. Teve alguma dificuldade?`,
          `Ei! Notei que você chegou a acessar o checkout 🛒 Precisa de ajuda com o pagamento?`,
          `Olá! Percebi que você acessou o link mas não concluiu ⏰ Posso te ajudar?`,
        ];

        const defaultMessages = stageMessages['qualificacao'];
        const messagePool = checkoutOpened
          ? checkoutOpenedMessages
          : (stageMessages[stageFromType] || defaultMessages);
        const message = messagePool[Math.min(reminderNum - 1, messagePool.length - 1)];
        const sendNumberId = fu.whatsapp_number_id;

        await sendMessage(supabaseUrl, supabaseKey, supabase, fu.phone, message, sendNumberId);

        const intervalMap: Record<number, number> = { 1: 30, 2: 120, 3: 120 };
        const nextInterval = intervalMap[reminderNum] || fu.interval_minutes;
        const nextReminder = new Date();
        nextReminder.setMinutes(nextReminder.getMinutes() + nextInterval);

        // If next reminder falls outside business hours, push to next day 8h BRT
        const nextBrtHour = new Date(nextReminder.getTime() - 3 * 60 * 60 * 1000).getUTCHours();
        if (nextBrtHour >= 18 || nextBrtHour < 8) {
          const rescheduled = getNextBusinessStart();
          console.log(`[followup] Next reminder for ${fu.phone} would be outside hours, rescheduling to ${rescheduled}`);
          nextReminder.setTime(new Date(rescheduled).getTime());
        }

        await supabase.from('chat_payment_followups').update({
          reminder_count: reminderNum,
          next_reminder_at: nextReminder.toISOString(),
        }).eq('id', fu.id);

        sent++;
        console.log(`[followup] Sent reminder ${reminderNum}/${fu.max_reminders} to ${fu.phone}`);
        await humanDelay();
      }
    }

    // ── PART 3: Scheduled followups ──
    const { data: scheduledItems } = await supabase
      .from('chat_scheduled_followups')
      .select('*')
      .eq('is_sent', false)
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at')
      .limit(MAX_SENDS_PER_RUN - abandonedSent - sent);

    let scheduledSent = 0;
    if (scheduledItems?.length) {
      for (const item of scheduledItems) {
        if (abandonedSent + sent + scheduledSent >= MAX_SENDS_PER_RUN) break;

        // ── Check if human operator is actively chatting ──
        const humanActiveScheduled = await isHumanActivelyChattingWith(supabase, item.phone);
        if (humanActiveScheduled) {
          console.log(`[followup] ${item.phone} has active human conversation, skipping scheduled followup`);
          await supabase.from('chat_scheduled_followups').update({
            scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          }).eq('id', item.id);
          continue;
        }

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

        const sendNumberId = item.whatsapp_number_id;
        await sendMessage(supabaseUrl, supabaseKey, supabase, item.phone, message, sendNumberId);

        await supabase.from('chat_scheduled_followups').update({
          is_sent: true,
          sent_at: new Date().toISOString(),
        }).eq('id', item.id);

        scheduledSent++;
        console.log(`[followup] Scheduled followup sent to ${item.phone}`);
        await humanDelay();
      }
    }

    return new Response(JSON.stringify({ 
      success: true, abandonedSent, sent, scheduledSent,
      maxPerRun: MAX_SENDS_PER_RUN 
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[followup] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
