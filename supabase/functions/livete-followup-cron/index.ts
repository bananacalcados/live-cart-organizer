import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFollowupPrompt } from "../_shared/livete-stage-prompts.ts";

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

async function generateFollowupMessage(
  stage: string,
  productsSummary: string,
  conversationHistory: string,
  customerName: string,
  apiKey: string,
): Promise<string> {
  const prompt = getFollowupPrompt(stage, productsSummary, conversationHistory, customerName);
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

  try {
    let text = '';

    if (ANTHROPIC_API_KEY) {
      // Use Anthropic Claude for follow-ups
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 150,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        console.error(`[livete-followup] Anthropic error ${response.status}`);
        return '';
      }

      const data = await response.json();
      text = data.content?.[0]?.text?.trim() || '';
    } else {
      // Fallback to Lovable AI Gateway
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-lite',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 150,
        }),
      });

      if (!response.ok) {
        console.error(`[livete-followup] AI error ${response.status}`);
        return '';
      }

      const data = await response.json();
      text = data.choices?.[0]?.message?.content?.trim() || '';
    }

    return text.replace(/^["']|["']$/g, '').trim();
  } catch (err) {
    console.error('[livete-followup] AI generation error:', err);
    return '';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    let created = 0;
    let sent = 0;
    let deactivated = 0;

    // ── STEP 1: Auto-create followups for active orders without one ──
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
        if ((order as any).ai_paused) continue;

        const normalizedPhone = phone.replace(/\D/g, '');

        const { data: existing } = await supabase
          .from('livete_followups')
          .select('id')
          .eq('order_id', order.id)
          .eq('is_active', true)
          .maybeSingle();

        if (existing) continue;

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
        if (minutesSince < LEVEL_INTERVALS[0]) continue;

        await supabase.from('livete_followups').insert({
          phone: normalizedPhone,
          order_id: order.id,
          event_id: order.event_id,
          stage_atendimento: order.stage_atendimento,
          reminder_level: 0,
          next_reminder_at: now.toISOString(),
          last_client_message_at: null,
          whatsapp_number_id: null,
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

      // Check if AI is paused
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

      // Check if client responded
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

      // Check max levels
      if (fu.reminder_level >= fu.max_levels) {
        await supabase.from('livete_followups').update({
          is_active: false, completed_at: now.toISOString(),
        }).eq('id', fu.id);
        deactivated++;

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

      // Get current stage and order data for context
      let currentStage = fu.stage_atendimento || 'contatado';
      let productsSummary = '';
      let customerName = '';

      if (fu.order_id) {
        const { data: orderData } = await supabase
          .from('orders')
          .select('stage_atendimento, products, customer_id')
          .eq('id', fu.order_id)
          .maybeSingle();
        if (orderData?.stage_atendimento) {
          currentStage = orderData.stage_atendimento;
        }
        if (orderData?.products) {
          const products = orderData.products as any[];
          productsSummary = products.map((p: any) =>
            `${p.quantity || 1}x ${p.title}${p.variant ? ` (${p.variant})` : ''}`
          ).join(', ');
        }
        if (orderData?.customer_id) {
          const { data: cust } = await supabase
            .from('customers')
            .select('instagram_handle')
            .eq('id', orderData.customer_id)
            .maybeSingle();
          customerName = cust?.instagram_handle || '';

          // Also check registration for real name
          const { data: reg } = await supabase
            .from('customer_registrations')
            .select('full_name')
            .eq('order_id', fu.order_id)
            .maybeSingle();
          if (reg?.full_name) customerName = reg.full_name;
        }
      }

      // Load recent conversation history for AI context
      const { data: history } = await supabase
        .from('whatsapp_messages')
        .select('message, direction')
        .eq('phone', fu.phone)
        .order('created_at', { ascending: false })
        .limit(8);

      const conversationHistory = (history || [])
        .reverse()
        .map((m: any) => `${m.direction === 'outgoing' ? 'Livete' : 'Cliente'}: ${m.message}`)
        .filter(Boolean)
        .join('\n');

      // Generate AI message
      let message = await generateFollowupMessage(
        currentStage, productsSummary, conversationHistory, customerName, LOVABLE_API_KEY
      );

      // Fallback if AI fails
      if (!message) {
        message = customerName
          ? `Oi ${customerName.split(' ')[0]}! Ainda posso te ajudar com seu pedido da live? 😊`
          : 'Oi! Ainda posso te ajudar com seu pedido da live? 😊';
      }

      // Determine send method
      let sendNumberId = fu.whatsapp_number_id;
      if (!sendNumberId) {
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

        // Calculate next reminder
        const level = fu.reminder_level;
        const nextLevel = level + 1;
        if (nextLevel < LEVEL_INTERVALS.length) {
          const intervalVal = LEVEL_INTERVALS[nextLevel];
          const nextReminder = intervalVal === -1
            ? getNextDay10am(now)
            : new Date(now.getTime() + intervalVal * 60000);
          await supabase.from('livete_followups').update({
            reminder_level: nextLevel,
            next_reminder_at: nextReminder.toISOString(),
            stage_atendimento: currentStage,
            updated_at: now.toISOString(),
          }).eq('id', fu.id);
        } else {
          await supabase.from('livete_followups').update({
            reminder_level: nextLevel,
            is_active: false,
            completed_at: now.toISOString(),
            updated_at: now.toISOString(),
          }).eq('id', fu.id);
          deactivated++;
        }

        sent++;
        console.log(`[livete-followup] AI sent level ${level} to ${fu.phone} (stage=${currentStage}): "${message.slice(0, 80)}"`);
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
