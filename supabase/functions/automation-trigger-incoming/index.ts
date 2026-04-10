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

    const { phone, messageText, instance, isGroup, whatsappNumberId: whatsappNumberIdFromBody } = await req.json();
    // instance: 'zapi' | whatsapp_number_id (Meta)
    // whatsappNumberId may be passed explicitly from zapi-webhook

    if (!phone) {
      return new Response(JSON.stringify({ error: 'phone required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Skip automation for group messages (VIP groups etc.)
    if (isGroup) {
      console.log(`[incoming-message-trigger] Skipping group message from ${phone}`);
      return new Response(JSON.stringify({ triggered: 0, reason: 'group message ignored' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[incoming-message-trigger] phone=${phone}, instance=${instance}`);

    // ─── Auto-reply detection: skip automated WhatsApp messages ────────
    const autoReplyPatterns = [
      /agra(deço|decemos)\s+(o\s+)?(seu\s+)?contato/i,
      /como\s+posso\s+te\s+ajudar\??/i,
      /em\s+breve\s+(retornaremos|responderemos|entraremos)/i,
      /mensagem\s+autom[áa]tica/i,
      /resposta\s+autom[áa]tica/i,
      /fora\s+do\s+hor[áa]rio/i,
      /obrigad[oa]\s+p(or|elo)\s+(seu\s+)?contato/i,
      /retornar(emos)?\s+(em\s+breve|o\s+mais\s+r[áa]pido)/i,
      /aguarde\s+(que\s+)?(um\s+)?(de\s+nossos|nosso)/i,
      /n[ãa]o\s+estamos\s+dispon[íi]veis/i,
    ];

    if (messageText && autoReplyPatterns.some(p => p.test(messageText))) {
      console.log(`[incoming-message-trigger] Auto-reply detected for ${phone}. Ignoring.`);
      return new Response(JSON.stringify({ triggered: 0, reason: 'auto_reply_ignored' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Fetch active flows with trigger_type = incoming_message
    const { data: flows } = await supabase
      .from('automation_flows')
      .select('*')
      .eq('trigger_type', 'incoming_message')
      .eq('is_active', true);

    if (!flows || flows.length === 0) {
      return new Response(JSON.stringify({ triggered: 0, reason: 'no active flows' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{ flowId: string; flowName: string; status: string; detail?: string }> = [];

    for (const flow of flows) {
      const config = flow.trigger_config as Record<string, unknown> | null;
      const cooldownHours = (config?.cooldown_hours as number) || 2;
      const maxPerDay = (config?.max_per_day as number) || 1;
      const instanceFilter = (config?.whatsapp_instances as string[]) || [];

      // 2. Check instance filter
      if (instanceFilter.length > 0) {
        const matchesInstance = instanceFilter.some(i => {
          if (i === 'zapi' && instance === 'zapi') return true;
          if (i === instance) return true; // Meta number ID match
          return false;
        });
        if (!matchesInstance) {
          results.push({ flowId: flow.id, flowName: flow.name, status: 'skipped', detail: 'Instance mismatch' });
          continue;
        }
      }

      // 3. Check if conversation is "finished" (human already handling)
      const { data: finished } = await supabase
        .from('chat_finished_conversations')
        .select('phone')
        .eq('phone', phone)
        .maybeSingle();

      // If conversation is marked finished, skip (human handled it)
      // Actually we should trigger if NOT finished - finished means done, so new message should trigger
      // The real check is: has there been an outgoing (human) message in the last cooldown_hours?

      // 4. Check cooldown: any outgoing message in last X hours?
      const cooldownDate = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();
      const { data: recentOutgoing } = await supabase
        .from('whatsapp_messages')
        .select('id')
        .eq('phone', phone)
        .eq('direction', 'outgoing')
        .gt('created_at', cooldownDate)
        .limit(1);

      if (recentOutgoing && recentOutgoing.length > 0) {
        results.push({ flowId: flow.id, flowName: flow.name, status: 'skipped', detail: `Outgoing message within ${cooldownHours}h cooldown` });
        continue;
      }

      // 5. Check max executions per day for this phone+flow
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: todayExecs } = await supabase
        .from('automation_executions')
        .select('id')
        .eq('flow_id', flow.id)
        .gte('executed_at', todayStart.toISOString());

      // Count executions for this specific phone today (store phone in result JSON)
      const { data: todayPhoneExecs } = await supabase
        .from('automation_executions')
        .select('id, result')
        .eq('flow_id', flow.id)
        .gte('executed_at', todayStart.toISOString());

      const phoneExecCount = (todayPhoneExecs || []).filter(e => {
        try {
          const r = e.result as Record<string, unknown>;
          return r?.phone === phone;
        } catch { return false; }
      }).length;

      if (phoneExecCount >= maxPerDay) {
        results.push({ flowId: flow.id, flowName: flow.name, status: 'skipped', detail: `Max ${maxPerDay} per day reached for ${phone}` });
        continue;
      }

      // 6. Check if there's an active AI session for this phone (avoid double automation)
      const { data: activeSession } = await supabase
        .from('automation_ai_sessions')
        .select('id')
        .eq('phone', phone)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (activeSession) {
        results.push({ flowId: flow.id, flowName: flow.name, status: 'skipped', detail: 'Active AI session exists' });
        continue;
      }

      // 7. Execute the flow steps
      const { data: steps } = await supabase
        .from('automation_steps')
        .select('*')
        .eq('flow_id', flow.id)
        .order('step_order', { ascending: true });

      if (!steps || steps.length === 0) {
        results.push({ flowId: flow.id, flowName: flow.name, status: 'skipped', detail: 'No steps configured' });
        continue;
      }

      // Determine which WhatsApp number to use for sending
      let sendInstance = instance; // default: same instance that received
      let whatsappNumberId: string | null = null;

      if (instance !== 'zapi') {
        whatsappNumberId = instance; // It's a Meta number ID
      }

      // If flow has specific instances configured, use the first one for sending
      if (instanceFilter.length > 0) {
        const firstInst = instanceFilter[0];
        if (firstInst === 'zapi') {
          sendInstance = 'zapi';
          whatsappNumberId = null;
        } else {
          sendInstance = 'meta';
          whatsappNumberId = firstInst;
        }
      }

      for (const step of steps) {
        const actionConfig = step.action_config as Record<string, unknown>;

        // Apply delay
        if (step.delay_seconds > 0) {
          await new Promise(r => setTimeout(r, step.delay_seconds * 1000));
        }

        try {
          if (step.action_type === 'send_template') {
            const templateName = actionConfig.templateName as string;
            const templateLanguage = actionConfig.language as string || 'pt_BR';
            const params = actionConfig.params as string[] || [];
            
            // Replace variables in params
            const resolvedParams = params.map((p: string) => {
              return p
                .replace('{{nome}}', messageText || '')
                .replace('{{telefone}}', phone);
            });

            const sendNumberId = (actionConfig.whatsappNumberId as string) || whatsappNumberId;

            const res = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send-template`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone,
                templateName,
                language: templateLanguage,
                params: resolvedParams,
                whatsappNumberId: sendNumberId,
              }),
            });

            const resData = await res.json();
            await supabase.from('automation_executions').insert({
              flow_id: flow.id, step_id: step.id, status: res.ok ? 'success' : 'error',
              error_message: res.ok ? null : JSON.stringify(resData),
              result: { phone, action: 'send_template', template: templateName },
            });

          } else if (step.action_type === 'send_text') {
            const text = (actionConfig.text as string) || (actionConfig.message as string) || '';
            if (!text) continue;

            if (sendInstance === 'zapi' || !whatsappNumberId) {
              await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, message: text, whatsapp_number_id: whatsappNumberId }),
              });
            } else {
              await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, message: text, whatsapp_number_id: whatsappNumberId }),
              });
            }

            await supabase.from('whatsapp_messages').insert({
              phone, message: text, direction: 'outgoing', status: 'sent',
              whatsapp_number_id: whatsappNumberId,
            });

            await supabase.from('automation_executions').insert({
              flow_id: flow.id, step_id: step.id, status: 'success',
              result: { phone, action: 'send_text' },
            });

          } else if (step.action_type === 'ai_response') {
            const prompt = (actionConfig.prompt as string) || '';
            const maxInteractions = (actionConfig.maxInteractions as number) || 5;
            const aiNumberId = (actionConfig.whatsappNumberId as string) || whatsappNumberId;

            // Create AI session
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            await supabase.from('automation_ai_sessions').upsert({
              phone,
              prompt,
              is_active: true,
              max_messages: maxInteractions,
              messages_sent: 0,
              expires_at: expiresAt,
              whatsapp_number_id: aiNumberId,
              flow_id: flow.id,
            }, { onConflict: 'phone' });

            // Generate first AI response with routing and tracking enabled
            const aiRes = await fetch(`${supabaseUrl}/functions/v1/automation-ai-respond`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, phone, enableRouting: true, enableTracking: true }),
            });
            const aiData = await aiRes.json();

            if (aiRes.ok && aiData.reply) {
              // Send via appropriate channel
              if (sendInstance === 'zapi' || !aiNumberId) {
                await fetch(`${supabaseUrl}/functions/v1/zapi-send-message`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phone, message: aiData.reply, whatsapp_number_id: whatsappNumberId }),
                });
              } else {
                await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phone, message: aiData.reply, whatsapp_number_id: aiNumberId }),
                });
              }

              await supabase.from('whatsapp_messages').insert({
                phone, message: aiData.reply, direction: 'outgoing', status: 'sent',
                whatsapp_number_id: aiNumberId,
              });
            }

            await supabase.from('automation_executions').insert({
              flow_id: flow.id, step_id: step.id, status: 'success',
              result: { phone, action: 'ai_response', replied: !!aiData?.reply },
            });

          } else if (step.action_type === 'delay') {
            // Already handled above
            await supabase.from('automation_executions').insert({
              flow_id: flow.id, step_id: step.id, status: 'success',
              result: { phone, action: 'delay', seconds: step.delay_seconds },
            });
          }
        } catch (stepErr) {
          console.error(`Step ${step.id} error:`, stepErr);
          await supabase.from('automation_executions').insert({
            flow_id: flow.id, step_id: step.id, status: 'error',
            error_message: String(stepErr),
            result: { phone },
          });
        }
      }

      results.push({ flowId: flow.id, flowName: flow.name, status: 'executed' });
    }

    console.log(`[incoming-message-trigger] Results:`, JSON.stringify(results));

    return new Response(JSON.stringify({ triggered: results.filter(r => r.status === 'executed').length, results }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[incoming-message-trigger] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
