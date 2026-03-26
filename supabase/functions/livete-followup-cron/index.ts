import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Intervals per reminder level (in minutes) — level 3 is special: next day at 10am
const LEVEL_INTERVALS = [5, 30, 120, -1]; // 5min, 30min, 2h, next-day-10am

function getNextDay10am(fromDate: Date): Date {
  const next = new Date(fromDate);
  next.setDate(next.getDate() + 1);
  // 10am Brasília (UTC-3) = 13:00 UTC
  next.setUTCHours(13, 0, 0, 0);
  return next;
}

// Contextual messages by stage_atendimento and level
const STAGE_MESSAGES: Record<string, string[]> = {
  endereco: [
    'Oi! 😊 Só preciso confirmar seu endereço pra dar andamento no pedido. Pode me passar?',
    'Oi! Ainda tô aguardando seu endereço pra continuar 📦 Qualquer dúvida, é só falar!',
    'Olá! Seu produto tá separadinho aqui esperando, só falta o endereço! Precisa de ajuda?',
    'Oi! Último aviso sobre seu pedido ⏰ Me passa seu endereço pra eu conseguir finalizar, tá?',
  ],
  dados_pessoais: [
    'Oi! Falta só seus dados (nome completo, CPF e email) pra gerar o pagamento! 😊',
    'Oi! Tô aguardando seus dados pra finalizar. É bem rapidinho! Precisa de ajuda?',
    'Olá! Seu pedido tá quase pronto, só falta CPF e email pra gerar o pagamento 💳',
    'Oi! Último aviso ⏰ Me manda seus dados (CPF e email) pra eu não perder o seu pedido!',
  ],
  forma_pagamento: [
    'Oi! Qual forma de pagamento prefere? PIX ou cartão? 💳',
    'Oi! Só falta escolher a forma de pagamento! PIX tem desconto especial 😊',
    'Olá! Tô com seu pedido prontinho, só preciso que escolha: PIX ou cartão?',
    'Oi! Último aviso sobre o pagamento ⏰ Me diz se prefere PIX ou cartão que já gero pra você!',
  ],
  aguardando_pix: [
    'Oi! Vi que o PIX ainda tá pendente 😊 O código tá ativo, é só copiar e colar no app do banco!',
    'Oi! Tá tendo dificuldade com o PIX? Posso gerar um novo código se precisar!',
    'Olá! O prazo do PIX tá acabando ⏰ Quer que eu gere um novo ou prefere pagar no cartão?',
    'Oi! Último aviso sobre o PIX pendente. Quer que eu cancele ou gere um novo código? Me avisa!',
  ],
  aguardando_cartao: [
    'Oi! Vi que o pagamento no cartão ainda não foi concluído. Tá tendo alguma dificuldade? 😊',
    'Oi! O link de pagamento ainda tá ativo! Precisa de ajuda pra finalizar?',
    'Olá! Se o cartão não tá passando, posso gerar um PIX pra você! O que acha?',
    'Oi! Último aviso ⏰ Me avisa se quer continuar com o cartão ou se prefere PIX!',
  ],
  contatado: [
    'Oi! Tudo bem? Vi que você separou um produto na live 😊 Posso te ajudar a finalizar?',
    'Oi! Seu produto ainda tá separadinho aqui! Quer continuar com a compra?',
    'Olá! Passando pra lembrar do seu pedido da live 🛍️ Posso te ajudar?',
    'Oi! Último aviso sobre o produto que você separou na live ⏰ Ainda tem interesse?',
  ],
};

const DEFAULT_MESSAGES = [
  'Oi! Tudo bem? Posso te ajudar com alguma coisa? 😊',
  'Oi! Ainda tô por aqui caso precise de ajuda!',
  'Olá! Precisa de alguma ajuda pra finalizar? Estou à disposição!',
  'Oi! Último aviso ⏰ Me avisa se ainda precisa de ajuda!',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    let created = 0;
    let sent = 0;
    let deactivated = 0;

    // ── STEP 1: Auto-create followups for active orders without one ──
    // Find orders in active events that are NOT paid and have a stage_atendimento
    const { data: activeEvents } = await supabase
      .from('events')
      .select('id')
      .eq('is_active', true);

    if (activeEvents && activeEvents.length > 0) {
      const eventIds = activeEvents.map((e: any) => e.id);

      const { data: unpaidOrders } = await supabase
        .from('orders')
        .select('id, event_id, customer_id, stage_atendimento, ai_paused, customers!inner(whatsapp)')
        .in('event_id', eventIds)
        .eq('is_paid', false)
        .not('stage_atendimento', 'is', null);

      for (const order of (unpaidOrders || [])) {
        const phone = (order as any).customers?.whatsapp;
        if (!phone) continue;

        // Skip if AI is paused for this order
        if ((order as any).ai_paused) continue;

        const normalizedPhone = phone.replace(/\D/g, '');

        // Check if followup already exists for this order
        const { data: existing } = await supabase
          .from('livete_followups')
          .select('id')
          .eq('order_id', order.id)
          .eq('is_active', true)
          .maybeSingle();

        if (existing) continue;

        // Check last message - if outgoing and old enough, create followup
        const { data: lastMsg } = await supabase
          .from('whatsapp_messages')
          .select('direction, created_at')
          .eq('phone', normalizedPhone)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastMsg || lastMsg.direction !== 'outgoing') continue;

        const lastMsgTime = new Date(lastMsg.created_at);
        const minutesSince = (now.getTime() - lastMsgTime.getTime()) / 60000;

        // Only create if last outgoing message was sent > 5 min ago
        if (minutesSince < LEVEL_INTERVALS[0]) continue;

        // Create followup entry - next reminder is NOW (will be processed below)
        await supabase.from('livete_followups').insert({
          phone: normalizedPhone,
          order_id: order.id,
          event_id: order.event_id,
          stage_atendimento: order.stage_atendimento,
          reminder_level: 0,
          next_reminder_at: now.toISOString(),
          last_client_message_at: null,
          whatsapp_number_id: null, // Will be determined from order context
        });

        created++;
      }
    }

    // ── STEP 2: Process pending followups ──
    const { data: followups } = await supabase
      .from('livete_followups')
      .select('*')
      .eq('is_active', true)
      .lte('next_reminder_at', now.toISOString())
      .order('next_reminder_at');

    if (!followups || followups.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'No pending followups', created, sent: 0, deactivated 
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[livete-followup] Processing ${followups.length} followups, created ${created} new`);

    for (const fu of followups) {
      // Check if order is now paid
      if (fu.order_id) {
        const { data: paidCheck } = await supabase.rpc('check_order_paid', { p_order_id: fu.order_id });
        if (paidCheck === true) {
          await supabase.from('livete_followups').update({
            is_active: false, completed_at: now.toISOString(),
          }).eq('id', fu.id);
          deactivated++;
          console.log(`[livete-followup] ${fu.phone} order paid, deactivated`);
          continue;
        }
      }

      // Check if AI is paused for this order
      if (fu.order_id) {
        const { data: order } = await supabase
          .from('orders')
          .select('ai_paused')
          .eq('id', fu.order_id)
          .maybeSingle();
        if (order?.ai_paused) {
          console.log(`[livete-followup] ${fu.phone} AI paused, skipping`);
          continue;
        }
      }

      // Check if client has responded since last followup was set
      const { data: lastIncoming } = await supabase
        .from('whatsapp_messages')
        .select('created_at')
        .eq('phone', fu.phone)
        .eq('direction', 'incoming')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastIncoming) {
        const incomingTime = new Date(lastIncoming.created_at);
        const followupUpdated = new Date(fu.updated_at || fu.created_at);

        // Client responded after followup was created/updated → deactivate
        if (incomingTime > followupUpdated) {
          await supabase.from('livete_followups').update({
            is_active: false, completed_at: now.toISOString(),
            last_client_message_at: lastIncoming.created_at,
          }).eq('id', fu.id);
          deactivated++;
          console.log(`[livete-followup] ${fu.phone} client responded, deactivated`);
          continue;
        }
      }

      // Check max levels — tag customer as non-responsive
      if (fu.reminder_level >= fu.max_levels) {
        await supabase.from('livete_followups').update({
          is_active: false, completed_at: now.toISOString(),
        }).eq('id', fu.id);
        deactivated++;

        // Tag customer as non-responsive for future nurturing funnels
        if (fu.order_id) {
          const { data: orderForTag } = await supabase
            .from('orders')
            .select('customer_id')
            .eq('id', fu.order_id)
            .maybeSingle();
          if (orderForTag?.customer_id) {
            const { data: cust } = await supabase
              .from('customers')
              .select('tags')
              .eq('id', orderForTag.customer_id)
              .maybeSingle();
            const tags: string[] = cust?.tags || [];
            if (!tags.includes('followup_sem_resposta')) {
              await supabase.from('customers').update({
                tags: [...tags, 'followup_sem_resposta'],
              }).eq('id', orderForTag.customer_id);
            }
          }
        }

        console.log(`[livete-followup] ${fu.phone} max levels reached, tagged`);
        continue;
      }

      // Get current stage from order (may have changed)
      let currentStage = fu.stage_atendimento || 'contatado';
      if (fu.order_id) {
        const { data: orderData } = await supabase
          .from('orders')
          .select('stage_atendimento')
          .eq('id', fu.order_id)
          .maybeSingle();
        if (orderData?.stage_atendimento) {
          currentStage = orderData.stage_atendimento;
        }
      }

      // Select message based on stage and level
      const stageMessages = STAGE_MESSAGES[currentStage] || DEFAULT_MESSAGES;
      const level = fu.reminder_level;
      const message = stageMessages[Math.min(level, stageMessages.length - 1)];

      // Determine send method - check if order has a whatsapp_number_id or use session
      let sendNumberId = fu.whatsapp_number_id;

      if (!sendNumberId) {
        // Try to find the whatsapp number from the AI session
        const { data: session } = await supabase
          .from('automation_ai_sessions')
          .select('whatsapp_number_id')
          .eq('phone', fu.phone)
          .eq('is_active', true)
          .maybeSingle();
        if (session?.whatsapp_number_id) {
          sendNumberId = session.whatsapp_number_id;
        }
      }

      // Send message
      try {
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

        // Calculate next reminder interval
        const nextLevel = level + 1;
        const nextIntervalMin = nextLevel < LEVEL_INTERVALS.length
          ? LEVEL_INTERVALS[nextLevel]
          : null; // No more levels

        if (nextIntervalMin !== null) {
          const nextReminder = new Date(now.getTime() + nextIntervalMin * 60000);
          await supabase.from('livete_followups').update({
            reminder_level: nextLevel,
            next_reminder_at: nextReminder.toISOString(),
            stage_atendimento: currentStage,
            updated_at: now.toISOString(),
          }).eq('id', fu.id);
        } else {
          // Max levels reached after this send
          await supabase.from('livete_followups').update({
            reminder_level: nextLevel,
            is_active: false,
            completed_at: now.toISOString(),
            updated_at: now.toISOString(),
          }).eq('id', fu.id);
          deactivated++;
        }

        sent++;
        console.log(`[livete-followup] Sent level ${level} to ${fu.phone} (stage=${currentStage})`);
      } catch (sendErr) {
        console.error(`[livete-followup] Send error for ${fu.phone}:`, sendErr);
      }

      // Small delay between sends
      await new Promise(r => setTimeout(r, 800));
    }

    return new Response(JSON.stringify({ 
      success: true, created, sent, deactivated, processed: followups.length 
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[livete-followup] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
