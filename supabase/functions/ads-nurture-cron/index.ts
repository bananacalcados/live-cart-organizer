import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get current time in Brazil
    const now = new Date();
    const brFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const brTimeFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit', minute: '2-digit',
    });
    const brDate = brFormatter.format(now); // YYYY-MM-DD
    const brTime = brTimeFormatter.format(now); // HH:MM

    console.log(`[nurture-cron] Running at BR date=${brDate} time=${brTime}`);

    // 1. Get active campaigns with events
    const { data: campaigns } = await supabase
      .from('ad_campaigns_ai')
      .select('id, name, event_id, whatsapp_number_id')
      .eq('is_active', true)
      .not('event_id', 'is', null);

    if (!campaigns || campaigns.length === 0) {
      return new Response(JSON.stringify({ message: 'No campaigns with events' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalSent = 0;

    for (const campaign of campaigns) {
      // 2. Get event date
      const { data: event } = await supabase
        .from('events')
        .select('id, name, starts_at, status')
        .eq('id', campaign.event_id)
        .maybeSingle();

      if (!event || event.status === 'ended') continue;

      const eventDate = new Date(event.starts_at);
      const eventDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(eventDate);

      // Calculate days until event
      const todayMs = new Date(brDate + 'T00:00:00').getTime();
      const eventMs = new Date(eventDateStr + 'T00:00:00').getTime();
      const daysUntilEvent = Math.round((eventMs - todayMs) / (1000 * 60 * 60 * 24));

      if (daysUntilEvent < 0) continue; // Event already passed

      // 3. Get nurture steps for this campaign that match today
      const { data: steps } = await supabase
        .from('ad_campaign_nurture_steps')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('is_active', true)
        .eq('days_before_event', daysUntilEvent);

      if (!steps || steps.length === 0) continue;

      for (const step of steps) {
        // Check if it's time to send (within 5min window)
        const stepTime = step.send_time?.slice(0, 5) || '10:00';
        if (brTime < stepTime || brTime > incrementTime(stepTime, 5)) continue;

        // 4. Get leads for this campaign that haven't received this step
        const { data: leads } = await supabase
          .from('ad_leads')
          .select('id, phone, name, whatsapp_number_id, channel, collected_data')
          .eq('campaign_id', campaign.id)
          .eq('is_active', true)
          .neq('temperature', 'convertido');

        if (!leads || leads.length === 0) continue;

        // Get already sent
        const { data: alreadySent } = await supabase
          .from('ad_nurture_sent')
          .select('lead_id')
          .eq('nurture_step_id', step.id);

        const sentLeadIds = new Set((alreadySent || []).map((s: any) => s.lead_id));

        for (const lead of leads) {
          if (sentLeadIds.has(lead.id)) continue;

          const leadName = lead.name || lead.collected_data?.nome || 'Cliente';
          const wNumberId = lead.whatsapp_number_id || campaign.whatsapp_number_id;

          try {
            // Determine channel and send
            if (lead.channel === 'meta' && step.meta_template_name) {
              // Send via Meta template
              const vars = step.meta_template_vars || {};
              const templateVars: Record<string, string> = {};
              for (const [k, v] of Object.entries(vars)) {
                templateVars[k] = String(v)
                  .replace('{{nome}}', leadName)
                  .replace('{{data_evento}}', eventDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
                  .replace('{{hora_evento}}', eventDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }))
                  .replace('{{nome_evento}}', event.name);
              }

              await supabase.functions.invoke('meta-whatsapp-send-template', {
                body: {
                  phone: lead.phone,
                  templateName: step.meta_template_name,
                  templateVars,
                },
              });
            } else if (step.zapi_message_text) {
              // Send via Z-API (free text)
              const message = step.zapi_message_text
                .replace('{{nome}}', leadName)
                .replace('{{data_evento}}', eventDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
                .replace('{{hora_evento}}', eventDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }))
                .replace('{{nome_evento}}', event.name);

              await supabase.functions.invoke('zapi-send-message', {
                body: {
                  phone: lead.phone,
                  message,
                  whatsapp_number_id: wNumberId,
                },
              });
            } else {
              continue; // No message configured for this channel
            }

            // Mark as sent
            await supabase.from('ad_nurture_sent').insert({
              lead_id: lead.id,
              nurture_step_id: step.id,
            });

            totalSent++;
            console.log(`[nurture-cron] Sent step "${step.id}" to lead ${lead.phone}`);

            // Small delay between sends
            await new Promise(r => setTimeout(r, 500));
          } catch (err) {
            console.error(`[nurture-cron] Error sending to ${lead.phone}:`, err);
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, totalSent }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[nurture-cron] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function incrementTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  const newH = Math.floor(totalMin / 60) % 24;
  const newM = totalMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}
