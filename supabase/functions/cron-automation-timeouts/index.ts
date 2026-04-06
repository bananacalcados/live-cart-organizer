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

    // Find all expired pending replies that are still active
    const { data: expired } = await supabase
      .from('automation_pending_replies')
      .select('*')
      .eq('is_active', true)
      .lt('expires_at', new Date().toISOString())
      .limit(100);

    if (!expired || expired.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[cron-automation-timeouts] Found ${expired.length} expired pending replies`);

    let processed = 0;
    for (const pending of expired) {
      try {
        // Mark as consumed
        await supabase.from('automation_pending_replies')
          .update({ is_active: false })
          .eq('id', pending.id);

        const branches = (pending.button_branches || {}) as Record<string, string>;
        const timeoutAction = branches.__timeout_action__ || 'cancel';
        const timeoutMessage = branches.__timeout_message__ || '';
        const timeoutTemplate = branches.__timeout_template__ || '';
        const timeoutTag = branches.__timeout_tag__ || '';
        const phone = pending.phone;
        const numberId = pending.whatsapp_number_id;

        console.log(`[timeout] ${phone} — action: ${timeoutAction}`);

        if (timeoutAction === 'cancel') {
          // Just cancel, do nothing
          processed++;
          continue;
        }

        if (timeoutAction === 'send_text' && timeoutMessage) {
          // Send follow-up text message (must use template since >24h window)
          // Note: since timeout means >24h, we can't send free-form text via Meta API
          // We log this as a limitation
          console.log(`[timeout] ${phone} — send_text requested but >24h window, skipping free text`);
          // Still try if within window (the Meta API will reject if outside)
          await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, message: timeoutMessage, whatsappNumberId: numberId }),
          });
        }

        if (timeoutAction === 'send_template' && timeoutTemplate) {
          await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send-template`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone,
              templateName: timeoutTemplate,
              language: 'pt_BR',
              whatsappNumberId: numberId,
            }),
          });
          console.log(`[timeout] ${phone} — sent template ${timeoutTemplate}`);
        }

        if (timeoutAction === 'add_tag' && timeoutTag) {
          // Add tag to zoppy_customers
          const last8 = phone.slice(-8);
          const { data: customers } = await supabase
            .from('zoppy_customers')
            .select('id, phone, tags')
            .limit(500);

          if (customers) {
            const match = customers.find((c: any) => c.phone?.slice(-8) === last8);
            if (match) {
              const currentTags = (match.tags as string[]) || [];
              if (!currentTags.includes(timeoutTag)) {
                await supabase.from('zoppy_customers')
                  .update({ tags: [...currentTags, timeoutTag] })
                  .eq('id', match.id);
                console.log(`[timeout] Tagged ${phone} with "${timeoutTag}"`);
              }
            }
          }
        }

        // After timeout action, continue flow from next step if action isn't cancel
        if (timeoutAction !== 'cancel') {
          // Check if there's a __timeout__ branch target from button branches
          const timeoutBranchTarget = branches.__timeout__;
          if (timeoutBranchTarget) {
            const { data: flowSteps } = await supabase
              .from('automation_steps')
              .select('id, step_order')
              .eq('flow_id', pending.flow_id)
              .order('step_order');

            if (flowSteps) {
              const targetIdx = flowSteps.findIndex(s => s.id === timeoutBranchTarget);
              if (targetIdx >= 0) {
                fetch(`${supabaseUrl}/functions/v1/automation-continue-flow`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    flowId: pending.flow_id,
                    phone,
                    startFromStep: targetIdx,
                    recipientData: pending.recipient_data,
                    whatsappNumberId: numberId,
                  }),
                }).catch(err => console.error('continue-flow error:', err));
              }
            }
          }
        }

        processed++;
      } catch (err) {
        console.error(`[timeout] Error processing ${pending.phone}:`, err);
      }
    }

    return new Response(JSON.stringify({ processed, total: expired.length }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[cron-automation-timeouts] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
