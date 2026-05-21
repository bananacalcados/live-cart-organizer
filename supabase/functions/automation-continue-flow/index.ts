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

    const { flowId, phone, startFromStep, recipientData, whatsappNumberId } = await req.json();

    if (!flowId || !phone) {
      return new Response(JSON.stringify({ error: 'flowId and phone required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[continue-flow] Continuing flow ${flowId} for ${phone} from step ${startFromStep}`);

    const { data: steps } = await supabase
      .from('automation_steps')
      .select('*')
      .eq('flow_id', flowId)
      .order('step_order');

    if (!steps || steps.length === 0) {
      return new Response(JSON.stringify({ error: 'No steps' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Collect all step IDs that are referenced as a branch target from ANY step.
    // These steps must ONLY be reached via an explicit branch — never via sequential flow.
    const branchTargetIds = new Set<string>();
    for (const s of steps) {
      const cfg = (s.action_config || {}) as any;
      const branches = cfg.buttonBranches || {};
      for (const v of Object.values(branches)) {
        if (typeof v === 'string') branchTargetIds.add(v);
      }
    }

    const rd = (recipientData || {}) as Record<string, string>;
    const firstName = rd.firstName || rd.name?.split(' ')[0] || 'Cliente';

    function replaceVars(text: string): string {
      return text
        .replace(/__first_name__/g, firstName)
        .replace(/__full_name__/g, rd.name || 'Cliente')
        .replace(/__phone__/g, phone)
        .replace(/__email__/g, rd.email || '')
        .replace(/__city__/g, rd.city || '')
        .replace(/__state__/g, rd.state || '')
        .replace(/\{\{nome\}\}/g, rd.name || 'Cliente')
        .replace(/\{\{telefone\}\}/g, phone);
    }

    for (let i = startFromStep; i < steps.length; i++) {
      const step = steps[i];
      const config = step.action_config as Record<string, unknown> || {};

      // Stop if we reached a step that is a branch target of ANOTHER step (not the current entry point).
      // It must only be reached via its branch, never via sequential flow.
      if (i !== startFromStep && branchTargetIds.has(step.id)) {
        console.log(`[continue-flow] Stopping at step ${i} (${step.id}) — it's a branch target of another step`);
        break;
      }

      // Apply delay
      if (step.delay_seconds > 0) {
        await new Promise(r => setTimeout(r, step.delay_seconds * 1000));
      }

      // If we hit another wait_for_reply, create a new pending reply and stop
      if (step.action_type === 'wait_for_reply') {
        const timeoutHours = (config.timeoutHours as number) || 24;
        const expiresAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000).toISOString();
        await supabase.from('automation_pending_replies').insert({
          phone,
          flow_id: flowId,
          pending_step_index: i + 1, // points to the step AFTER wait_for_reply
          step_id: step.id,
          button_branches: config.timeoutAction ? { __timeout_action__: config.timeoutAction, __timeout_message__: config.timeoutMessage || '', __timeout_template__: config.timeoutTemplateName || '', __timeout_tag__: config.timeoutTag || '' } : {},
          whatsapp_number_id: whatsappNumberId,
          recipient_data: recipientData || {},
          expires_at: expiresAt,
        });
        console.log(`[continue-flow] Created pending reply at step ${i} for ${phone}, expires: ${expiresAt}`);
        break;
      }

      if (step.action_type === 'delay') {
        continue; // delay already applied above
      }

      const sendNumberId = (config.whatsappNumberId as string) || whatsappNumberId;

      if (step.action_type === 'send_template') {
        const templateName = config.templateName as string;
        if (!templateName) continue;

        const components: unknown[] = [];

        if (config.headerMediaUrl) {
          const isVideo = /\.(mp4|mov|avi|webm)/i.test(config.headerMediaUrl as string);
          const headerType = isVideo ? 'video' : 'image';
          components.push({
            type: 'HEADER',
            parameters: [{ type: headerType, [headerType]: { link: config.headerMediaUrl } }],
          });
        }

        const templateVars = config.templateVars as Record<string, string> | undefined;
        if (templateVars && Object.keys(templateVars).length > 0) {
          const bodyParams = Object.keys(templateVars)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(k => ({ type: 'text', text: replaceVars(templateVars[k]) }));
          components.push({ type: 'BODY', parameters: bodyParams });
        }

        const buttonVars = config.buttonVars as Record<string, string> | undefined;
        if (buttonVars && Object.keys(buttonVars).length > 0) {
          Object.keys(buttonVars).forEach(idx => {
            components.push({
              type: 'BUTTON', sub_type: 'url', index: parseInt(idx),
              parameters: [{ type: 'text', text: buttonVars[idx] }],
            });
          });
        }

        await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send-template`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone, templateName,
            language: (config.language as string) || 'pt_BR',
            whatsappNumberId: sendNumberId,
            components: components.length > 0 ? components : undefined,
          }),
        });

        await supabase.from('automation_executions').insert({
          flow_id: flowId, step_id: step.id, status: 'success',
          result: { phone, action: 'send_template', template: templateName, continued: true },
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
            phone, flow_id: flowId, pending_step_index: i + 1,
            step_id: step.id, button_branches: textBranches,
            whatsapp_number_id: sendNumberId || null,
            recipient_data: recipientData || {},
          });
          console.log(`[continue-flow] Created pending reply for button branches at step ${i}, next=${i + 1}`);
          break;
        }
      }

      if (step.action_type === 'send_text') {
        // Build block list (backwards-compatible: legacy single message + mediaUrl as 1 or 2 blocks)
        const rawBlocks: any[] = Array.isArray(config.blocks) && (config.blocks as any[]).length > 0
          ? (config.blocks as any[])
          : [
              ...((config.message as string) ? [{ type: 'text', message: config.message }] : []),
              ...(config.mediaUrl ? [{ type: (config.mediaType as string) || 'document', mediaUrl: config.mediaUrl, mediaType: config.mediaType }] : []),
            ];
        const interactiveButtons = (config.interactiveButtons as string[]) || [];
        const hasButtons = interactiveButtons.length > 0;

        if (rawBlocks.length === 0 && !hasButtons) continue;

        // If buttons present, last text block becomes interactive body
        let lastTextIdxForInteractive = -1;
        if (hasButtons) {
          for (let bi = rawBlocks.length - 1; bi >= 0; bi--) {
            if (rawBlocks[bi].type === 'text' || rawBlocks[bi].message) { lastTextIdxForInteractive = bi; break; }
          }
        }

        for (let bi = 0; bi < rawBlocks.length; bi++) {
          const blk = rawBlocks[bi];
          const isLastInteractive = hasButtons && bi === lastTextIdxForInteractive;
          if (isLastInteractive) {
            const bodyText = replaceVars(blk.message || '') || '👇';
            await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone, type: 'interactive',
                whatsappNumberId: sendNumberId,
                interactiveData: {
                  body: bodyText,
                  buttons: interactiveButtons.slice(0, 3).map((title, idx) => ({ id: `btn-${idx}`, title })),
                },
              }),
            });
            await supabase.from('whatsapp_messages').insert({
              phone, message: bodyText, direction: 'outgoing', status: 'sent',
              whatsapp_number_id: sendNumberId || null,
            });
          } else {
            const blkType = blk.type || (blk.mediaUrl ? (blk.mediaType || 'document') : 'text');
            const blkMessage = replaceVars(blk.message || '');
            await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone,
                message: blkMessage,
                mediaUrl: blk.mediaUrl,
                mediaType: blk.mediaType || (blkType !== 'text' ? blkType : undefined),
                type: blk.mediaUrl ? blkType : 'text',
                whatsappNumberId: sendNumberId,
              }),
            });
            // Persist outgoing message (audio/text/media) so it shows up in the chat UI
            await supabase.from('whatsapp_messages').insert({
              phone,
              message: blkMessage || null,
              media_url: blk.mediaUrl || null,
              direction: 'outgoing',
              status: 'sent',
              whatsapp_number_id: sendNumberId || null,
            });
          }
          if (bi < rawBlocks.length - 1) await new Promise(r => setTimeout(r, 800));
        }

        await supabase.from('automation_executions').insert({
          flow_id: flowId, step_id: step.id, status: 'success',
          result: { phone, action: 'send_text', blocks: rawBlocks.length, hasButtons, continued: true },
        });

        // If buttons present and branches configured, register pending reply and stop
        if (hasButtons && config.buttonBranches && Object.keys(config.buttonBranches as object).length > 0) {
          const textBranches: Record<string, string> = {};
          const branches = config.buttonBranches as Record<string, string>;
          for (const [handleId, targetStepId] of Object.entries(branches)) {
            const idx = parseInt(handleId.replace('btn-', ''));
            if (!isNaN(idx) && interactiveButtons[idx]) {
              textBranches[interactiveButtons[idx].toLowerCase()] = targetStepId;
            }
          }
          await supabase.from('automation_pending_replies').insert({
            phone, flow_id: flowId, pending_step_index: i + 1,
            step_id: step.id, button_branches: textBranches,
            whatsapp_number_id: sendNumberId || null,
            recipient_data: recipientData || {},
          });
          console.log(`[continue-flow] send_text+buttons created pending reply at step ${i}, next=${i + 1}`);
          break;
        }
      }

      if (step.action_type === 'add_tag') {
        console.log(`[continue-flow] Tag: ${JSON.stringify(config.tags)}`);
      }

      // Handle AI response step: create AI session (the webhook will auto-respond on subsequent messages)
      if (step.action_type === 'ai_response') {
        const prompt = (config.prompt as string) || '';
        const maxInteractions = (config.maxInteractions as number) || 5;
        const aiNumberId = (config.whatsappNumberId as string) || whatsappNumberId;

        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('automation_ai_sessions').upsert({
          phone,
          prompt,
          is_active: true,
          max_messages: maxInteractions,
          messages_sent: 0,
          expires_at: expiresAt,
          whatsapp_number_id: aiNumberId,
          flow_id: flowId,
        }, { onConflict: 'phone' });

        // Generate first AI response immediately (since the customer just replied, we're in the 24h window)
        const aiRes = await fetch(`${supabaseUrl}/functions/v1/automation-ai-respond`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, phone, enableRouting: true, enableTracking: true, whatsappNumberId: aiNumberId, flowId }),
        });
        const aiData = await aiRes.json();

        if (aiRes.ok && aiData.reply) {
          await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, message: aiData.reply, whatsappNumberId: aiNumberId }),
          });

          await supabase.from('whatsapp_messages').insert({
            phone, message: `[IA] ${aiData.reply}`, direction: 'outgoing', status: 'sent',
            whatsapp_number_id: aiNumberId,
          });
        }

        await supabase.from('automation_executions').insert({
          flow_id: flowId, step_id: step.id, status: 'success',
          result: { phone, action: 'ai_response', replied: !!aiData?.reply, continued: true },
        });

        console.log(`[continue-flow] AI session created for ${phone}, replied=${!!aiData?.reply}`);
        // After AI response, the session handles further messages via the router
        break;
      }

      await new Promise(r => setTimeout(r, 500));
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[continue-flow] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
