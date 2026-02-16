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

    const { phone, name, campaignTag } = await req.json();

    if (!phone) {
      return new Response(
        JSON.stringify({ error: 'phone is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find active flows with trigger_type = 'new_lead'
    const { data: flows, error: flowsErr } = await supabase
      .from('automation_flows')
      .select('id, name, trigger_config')
      .eq('trigger_type', 'new_lead')
      .eq('is_active', true);

    if (flowsErr) {
      console.error('Error fetching flows:', flowsErr);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch flows' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!flows || flows.length === 0) {
      console.log('No active new_lead flows found');
      return new Response(
        JSON.stringify({ success: true, message: 'No active flows', triggered: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format phone for WhatsApp (Brazilian)
    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.length >= 10 && formattedPhone.length <= 11) {
      formattedPhone = '55' + formattedPhone;
    }
    if (formattedPhone.startsWith('55') && formattedPhone.length === 12) {
      const ddd = formattedPhone.substring(2, 4);
      const number = formattedPhone.substring(4);
      if (!number.startsWith('9')) {
        formattedPhone = '55' + ddd + '9' + number;
      }
    }

    const results: Array<{ flowId: string; flowName: string; status: string; detail?: string }> = [];

    for (const flow of flows) {
      // Optional: filter by campaign tags in trigger_config
      const triggerConfig = flow.trigger_config as Record<string, unknown> | null;
      const configTags = triggerConfig?.campaign_tags as string[] | undefined;
      // If flow has campaign_tags configured, check if incoming campaignTag matches any
      if (configTags && configTags.length > 0 && campaignTag) {
        if (!configTags.includes(campaignTag)) {
          results.push({ flowId: flow.id, flowName: flow.name, status: 'skipped', detail: 'Campaign mismatch' });
          continue;
        }
      }
      // Legacy support: single campaign_id field
      const legacyCampaignId = triggerConfig?.campaign_id as string | undefined;
      if (!configTags?.length && legacyCampaignId && campaignTag && legacyCampaignId !== campaignTag) {
        results.push({ flowId: flow.id, flowName: flow.name, status: 'skipped', detail: 'Campaign mismatch (legacy)' });
        continue;
      }

      // Fetch steps for this flow
      const { data: steps, error: stepsErr } = await supabase
        .from('automation_steps')
        .select('*')
        .eq('flow_id', flow.id)
        .order('step_order');

      if (stepsErr || !steps?.length) {
        results.push({ flowId: flow.id, flowName: flow.name, status: 'error', detail: 'No steps found' });
        continue;
      }

      // Replace variables
      const firstName = name ? name.split(' ')[0] : 'Cliente';
      function replaceVars(text: string): string {
        return text
          // Dynamic field markers
          .replace(/__first_name__/g, firstName)
          .replace(/__full_name__/g, name || 'Cliente')
          .replace(/__phone__/g, phone || '')
          .replace(/__email__/g, '')
          .replace(/__city__/g, '')
          .replace(/__state__/g, '')
          // Legacy {{var}} markers
          .replace(/\{\{nome\}\}/g, name || 'Cliente')
          .replace(/\{\{telefone\}\}/g, phone || '')
          .replace(/\{\{email\}\}/g, '')
          .replace(/\{\{instagram\}\}/g, '')
          .replace(/\{\{cidade\}\}/g, '')
          .replace(/\{\{cupom\}\}/g, '');
      }

      console.log(`Executing flow "${flow.name}" for phone ${formattedPhone}`);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const config = step.action_config as Record<string, unknown> || {};

        // Stop at delays (async not implemented) but handle wait_for_reply by creating pending reply
        if (step.action_type === 'delay') {
          console.log(`Step ${i + 1}: delay — stopping execution (async continuation not yet implemented)`);
          break;
        }
        if (step.action_type === 'wait_for_reply') {
          const branches = (config.branches || {}) as Record<string, number>;
          await supabase.from('automation_pending_replies').insert({
            phone: formattedPhone,
            flow_id: flow.id,
            pending_step_index: i,
            step_id: step.id,
            button_branches: branches,
            whatsapp_number_id: (config.whatsappNumberId as string) || null,
            recipient_data: { name: name || '', firstName: name ? name.split(' ')[0] : '' },
          });
          console.log(`Step ${i + 1}: wait_for_reply — created pending reply for ${formattedPhone}`);
          break;
        }

        if (step.action_type === 'send_template') {
          const templateName = config.templateName as string;
          if (!templateName) {
            console.error(`Step ${i + 1}: No template configured`);
            continue;
          }

          // Build components
          const components: unknown[] = [];

          // Header media
          if (config.headerMediaUrl) {
            const headerFormat = (config.headerMediaUrl as string).match(/\.(mp4|mov|avi)/i) ? 'video' : 'image';
            components.push({
              type: 'HEADER',
              parameters: [{ type: headerFormat, [headerFormat]: { link: config.headerMediaUrl } }],
            });
          }

          // Body variables
          const templateVars = config.templateVars as Record<string, string> | undefined;
          if (templateVars && Object.keys(templateVars).length > 0) {
            const bodyParams = Object.keys(templateVars)
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map(k => ({ type: 'text', text: replaceVars(templateVars[k]) }));
            components.push({ type: 'BODY', parameters: bodyParams });
          }

          // Button variables
          const buttonVars = config.buttonVars as Record<string, string> | undefined;
          if (buttonVars && Object.keys(buttonVars).length > 0) {
            Object.keys(buttonVars).forEach(idx => {
              components.push({
                type: 'BUTTON',
                sub_type: 'url',
                index: parseInt(idx),
                parameters: [{ type: 'text', text: buttonVars[idx] }],
              });
            });
          }

          try {
            const sendRes = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send-template`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                phone: formattedPhone,
                templateName,
                language: (config.language as string) || 'pt_BR',
                whatsappNumberId: config.whatsappNumberId,
                components: components.length > 0 ? components : undefined,
              }),
            });
            const sendData = await sendRes.json();
            if (sendRes.ok) {
              console.log(`Step ${i + 1}: Template "${templateName}" sent successfully`);

              await supabase.from('automation_executions').insert({
                flow_id: flow.id,
                step_id: step.id,
                status: 'success',
                result: { messageId: sendData.messageId, phone: formattedPhone },
              });

              // If template has buttonBranches, create pending reply and stop
              if (config.quickReplyButtons?.length > 0 && config.buttonBranches) {
                const textBranches: Record<string, string> = {};
                const qrButtons = config.quickReplyButtons as string[];
                const branches = config.buttonBranches as Record<string, string>;
                for (const [handleId, targetStepId] of Object.entries(branches)) {
                  if (handleId === 'btn-timeout') {
                    textBranches['__timeout__'] = targetStepId;
                  } else {
                    const idx = parseInt(handleId.replace('btn-', ''));
                    if (qrButtons[idx]) {
                      textBranches[qrButtons[idx].toLowerCase()] = targetStepId;
                    }
                  }
                }
                await supabase.from('automation_pending_replies').insert({
                  phone: formattedPhone,
                  flow_id: flow.id,
                  pending_step_index: i,
                  step_id: step.id,
                  button_branches: textBranches,
                  whatsapp_number_id: (config.whatsappNumberId as string) || null,
                  recipient_data: { name: name || '', firstName },
                });
                console.log(`Step ${i + 1}: Created pending reply for button branches: ${qrButtons.join(', ')}`);
                break; // Stop execution, wait for button click
              }
            } else {
              console.error(`Step ${i + 1}: Template send failed:`, sendData);
              await supabase.from('automation_executions').insert({
                flow_id: flow.id,
                step_id: step.id,
                status: 'error',
                error_message: sendData.error || JSON.stringify(sendData),
              });
            }
          } catch (e) {
            console.error(`Step ${i + 1}: Error:`, e);
          }
        }

        if (step.action_type === 'send_text') {
          const message = replaceVars((config.message as string) || '');
          if (!message) continue;

          try {
            const sendRes = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                phone: formattedPhone,
                message,
                mediaUrl: config.mediaUrl,
                mediaType: config.mediaType,
                whatsappNumberId: config.whatsappNumberId,
              }),
            });
            const sendData = await sendRes.json();
            console.log(`Step ${i + 1}: Text send ${sendRes.ok ? 'ok' : 'failed'}`, sendData);
          } catch (e) {
            console.error(`Step ${i + 1}: Error sending text:`, e);
          }
        }

        if (step.action_type === 'add_tag') {
          console.log(`Step ${i + 1}: Tag action logged (tags: ${JSON.stringify(config.tags)})`);
        }

        if (step.action_type === 'ai_response') {
          const aiPrompt = config.prompt as string || '';
          try {
            const aiRes = await fetch(`${supabaseUrl}/functions/v1/automation-ai-respond`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ prompt: aiPrompt, phone: formattedPhone }),
            });
            const aiData = await aiRes.json();
            if (aiRes.ok && aiData.reply) {
              const typingDelay = Math.min(Math.max(aiData.reply.length * 50, 2000), 12000);
              await new Promise(r => setTimeout(r, typingDelay));

              await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ phone: formattedPhone, message: aiData.reply, whatsappNumberId: config.whatsappNumberId }),
              });

              if (config.whatsappNumberId) {
                await supabase.from('automation_ai_sessions').upsert({
                  phone: formattedPhone,
                  prompt: aiPrompt,
                  whatsapp_number_id: config.whatsappNumberId as string,
                  flow_id: flow.id,
                  is_active: true,
                  messages_sent: 1,
                  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                }, { onConflict: 'phone' });
              }
            }
          } catch (e) {
            console.error(`Step ${i + 1}: AI error:`, e);
          }
        }

        // Pause between steps
        await new Promise(r => setTimeout(r, 500));
      }

      results.push({ flowId: flow.id, flowName: flow.name, status: 'executed' });
    }

    return new Response(
      JSON.stringify({ success: true, triggered: results.length, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in automation-trigger-new-lead:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error', details: error instanceof Error ? error.message : 'Unknown' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
