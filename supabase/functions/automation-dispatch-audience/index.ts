import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizePhone(rawPhone: string): string {
  let phone = rawPhone.replace(/\D/g, '');
  if (phone.length >= 10 && phone.length <= 11) {
    phone = '55' + phone;
  }
  if (phone.startsWith('55') && phone.length === 12) {
    const ddd = phone.substring(2, 4);
    const number = phone.substring(4);
    phone = '55' + ddd + '9' + number;
  }
  return phone;
}

async function fetchAllRows(supabase: ReturnType<typeof createClient>, table: string, columns: string, filters?: Record<string, unknown>): Promise<any[]> {
  const allData: any[] = [];
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  while (hasMore) {
    let query = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (Array.isArray(value) && value.length > 0) {
          query = query.in(key, value);
        }
      }
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) { hasMore = false; break; }
    allData.push(...data);
    if (data.length < pageSize) hasMore = false;
    else from += pageSize;
  }
  return allData;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const MAX_RUNTIME_MS = 50000; // 50 seconds safety limit

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { flowId, dryRun } = await req.json();

    if (!flowId) {
      return new Response(JSON.stringify({ error: 'flowId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch flow
    const { data: flow } = await supabase
      .from('automation_flows')
      .select('*')
      .eq('id', flowId)
      .single();

    if (!flow) {
      return new Response(JSON.stringify({ error: 'Flow not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const triggerConfig = (flow.trigger_config || {}) as Record<string, unknown>;
    const audienceSource = (triggerConfig.audience_source as string) || 'rfm';
    const selectedRfmSegments = (triggerConfig.audience_rfm_segments as string[]) || [];
    const rfmSelectAll = triggerConfig.audience_rfm_all as boolean ?? false;
    const selectedCampaigns = (triggerConfig.audience_campaigns as string[]) || [];
    const selectedStates = (triggerConfig.audience_states as string[]) || [];
    const selectedCities = (triggerConfig.audience_cities as string[]) || [];
    const selectedRegions = (triggerConfig.audience_regions as string[]) || [];
    const selectedGenders = (triggerConfig.audience_genders as string[]) || [];
    const whatsappInstances = (triggerConfig.whatsapp_instances as string[]) || [];

    // Build audience phone list with names
    const audience: Array<{ phone: string; name: string; email?: string; city?: string; state?: string }> = [];
    const seenPhones = new Set<string>();

    // RFM / CRM audience
    if (audienceSource === 'rfm' || audienceSource === 'both') {
      let rfmData: any[] = [];
      if (rfmSelectAll) {
        rfmData = await fetchAllRows(supabase, 'zoppy_customers', 'phone, first_name, last_name, email, city, state, rfm_segment, region_type, gender');
      } else if (selectedRfmSegments.length > 0) {
        rfmData = await fetchAllRows(supabase, 'zoppy_customers', 'phone, first_name, last_name, email, city, state, rfm_segment, region_type, gender', {
          rfm_segment: selectedRfmSegments,
        });
      }

      // Apply additional filters
      for (const row of rfmData) {
        if (!row.phone) continue;
        if (selectedStates.length > 0 && !selectedStates.includes(row.state)) continue;
        if (selectedCities.length > 0 && !selectedCities.includes(row.city)) continue;
        if (selectedRegions.length > 0 && !selectedRegions.includes(row.region_type)) continue;
        if (selectedGenders.length > 0 && !selectedGenders.includes(row.gender)) continue;

        const phone = normalizePhone(row.phone);
        if (phone.length < 12 || seenPhones.has(phone)) continue;
        seenPhones.add(phone);

        const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Cliente';
        audience.push({ phone, name: fullName, email: row.email, city: row.city, state: row.state });
      }
    }

    // Leads audience
    if (audienceSource === 'leads' || audienceSource === 'both') {
      let leadsData: any[];
      if (selectedCampaigns.length > 0) {
        leadsData = await fetchAllRows(supabase, 'lp_leads', 'phone, name, email, campaign_tag', {
          campaign_tag: selectedCampaigns,
        });
      } else {
        leadsData = await fetchAllRows(supabase, 'lp_leads', 'phone, name, email, campaign_tag');
      }

      for (const row of leadsData) {
        if (!row.phone) continue;
        const phone = normalizePhone(row.phone);
        if (phone.length < 12 || seenPhones.has(phone)) continue;
        seenPhones.add(phone);
        audience.push({ phone, name: row.name || 'Cliente', email: row.email });
      }
    }

    // CRM source (all zoppy_customers without segment filter)
    if (audienceSource === 'crm') {
      const crmData = await fetchAllRows(supabase, 'zoppy_customers', 'phone, first_name, last_name, email, city, state, region_type, gender');
      for (const row of crmData) {
        if (!row.phone) continue;
        if (selectedStates.length > 0 && !selectedStates.includes(row.state)) continue;
        if (selectedCities.length > 0 && !selectedCities.includes(row.city)) continue;
        if (selectedRegions.length > 0 && !selectedRegions.includes(row.region_type)) continue;
        if (selectedGenders.length > 0 && !selectedGenders.includes(row.gender)) continue;

        const phone = normalizePhone(row.phone);
        if (phone.length < 12 || seenPhones.has(phone)) continue;
        seenPhones.add(phone);
        const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Cliente';
        audience.push({ phone, name: fullName, email: row.email, city: row.city, state: row.state });
      }
    }

    console.log(`[dispatch] Audience size: ${audience.length} for flow "${flow.name}"`);

    // Dry run: just return count
    if (dryRun) {
      return new Response(JSON.stringify({ success: true, audienceCount: audience.length }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch flow steps
    const { data: steps } = await supabase
      .from('automation_steps')
      .select('*')
      .eq('flow_id', flowId)
      .order('step_order');

    if (!steps || steps.length === 0) {
      return new Response(JSON.stringify({ error: 'No steps in flow' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine which WhatsApp number to use
    const defaultNumberId = whatsappInstances.length > 0 ? whatsappInstances[0] : null;

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const recipient of audience) {
      // Check time limit
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log(`[dispatch] Time limit reached after ${sent} sent, ${failed} failed. Remaining: ${audience.length - sent - failed - skipped}`);
        break;
      }

      const firstName = recipient.name.split(' ')[0];

      function replaceVars(text: string): string {
        return text
          .replace(/__first_name__/g, firstName)
          .replace(/__full_name__/g, recipient.name)
          .replace(/__phone__/g, recipient.phone)
          .replace(/__email__/g, recipient.email || '')
          .replace(/__city__/g, recipient.city || '')
          .replace(/__state__/g, recipient.state || '')
          .replace(/\{\{nome\}\}/g, recipient.name)
          .replace(/\{\{telefone\}\}/g, recipient.phone)
          .replace(/\{\{email\}\}/g, recipient.email || '')
          .replace(/\{\{cidade\}\}/g, recipient.city || '');
      }

      // Execute first step only (subsequent steps handled by continue-flow or pending replies)
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const config = step.action_config as Record<string, unknown> || {};
        const sendNumberId = (config.whatsappNumberId as string) || defaultNumberId;

        if (step.action_type === 'delay') {
          // Don't wait for delays in mass dispatch — note for future: queue these
          continue;
        }

        if (step.action_type === 'wait_for_reply') {
          break; // Already handled by template step below
        }

        if (step.action_type === 'send_template') {
          const templateName = config.templateName as string;
          if (!templateName) { skipped++; break; }

          const components: unknown[] = [];

          // Header media
          if (config.headerMediaUrl) {
            const isVideo = /\.(mp4|mov|avi|webm)/i.test(config.headerMediaUrl as string);
            const isDocument = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)/i.test(config.headerMediaUrl as string);
            let headerType = 'image';
            if (isVideo) headerType = 'video';
            if (isDocument) headerType = 'document';
            components.push({
              type: 'HEADER',
              parameters: [{ type: headerType, [headerType]: { link: config.headerMediaUrl } }],
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
                type: 'BUTTON', sub_type: 'url', index: parseInt(idx),
                parameters: [{ type: 'text', text: buttonVars[idx] }],
              });
            });
          }

          // Carousel cards
          const carouselCards = config.carouselCards as Record<string, any> | undefined;
          if (carouselCards && Object.keys(carouselCards).length > 0) {
            const cards: any[] = [];
            Object.keys(carouselCards).sort().forEach(cardIdx => {
              const cc = carouselCards[cardIdx];
              const cardComponents: any[] = [];
              if (cc.headerUrl) {
                const isVideo = cc.headerUrl.match(/\.(mp4|mov|avi)/i);
                const mediaType = isVideo ? 'video' : 'image';
                cardComponents.push({ type: 'HEADER', parameters: [{ type: mediaType, [mediaType]: { link: cc.headerUrl } }] });
              }
              if (cc.bodyVars && Object.keys(cc.bodyVars).length > 0) {
                const params = Object.keys(cc.bodyVars).sort((a, b) => parseInt(a) - parseInt(b)).map(k => ({ type: 'text', text: replaceVars(cc.bodyVars[k]) }));
                cardComponents.push({ type: 'BODY', parameters: params });
              }
              if (cc.buttonVars && Object.keys(cc.buttonVars).length > 0) {
                Object.keys(cc.buttonVars).forEach(btnIdx => {
                  cardComponents.push({ type: 'BUTTON', sub_type: 'url', index: parseInt(btnIdx), parameters: [{ type: 'text', text: cc.buttonVars[btnIdx] }] });
                });
              }
              cards.push({ card_index: parseInt(cardIdx), components: cardComponents });
            });
            if (cards.length > 0) components.push({ type: 'CAROUSEL', cards });
          }

          try {
            const sendRes = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send-template`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone: recipient.phone,
                templateName,
                language: (config.language as string) || 'pt_BR',
                whatsappNumberId: sendNumberId,
                components: components.length > 0 ? components : undefined,
              }),
            });

            if (sendRes.ok) {
              sent++;

              // If template has button branches, create pending reply for this recipient
              if (config.quickReplyButtons && (config.quickReplyButtons as string[]).length > 0 && config.buttonBranches) {
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
                  phone: recipient.phone,
                  flow_id: flowId,
                  pending_step_index: i,
                  step_id: step.id,
                  button_branches: textBranches,
                  whatsapp_number_id: sendNumberId || null,
                  recipient_data: { name: recipient.name, firstName, email: recipient.email, city: recipient.city, state: recipient.state },
                });
              }

              // Log execution
              if (sent % 100 === 0) {
                console.log(`[dispatch] Progress: ${sent} sent, ${failed} failed`);
              }
            } else {
              const errData = await sendRes.json().catch(() => ({}));
              failed++;
              if (failed <= 5) {
                console.error(`[dispatch] Failed for ${recipient.phone}:`, errData);
              }
            }
          } catch (e) {
            failed++;
          }

          // Rate limiting: ~80 msgs/sec is Meta's limit, we go slower for safety
          await new Promise(r => setTimeout(r, 100));
          break; // Only execute first actionable step
        }

        if (step.action_type === 'send_text') {
          const message = replaceVars((config.message as string) || '');
          if (!message && !config.mediaUrl) { skipped++; break; }

          try {
            const sendRes = await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone: recipient.phone,
                message,
                mediaUrl: config.mediaUrl,
                mediaType: config.mediaType,
                whatsappNumberId: (config.whatsappNumberId as string) || defaultNumberId,
              }),
            });
            if (sendRes.ok) sent++;
            else failed++;
          } catch {
            failed++;
          }

          await new Promise(r => setTimeout(r, 100));
          break;
        }

        if (step.action_type === 'add_tag') {
          continue; // Skip tags, proceed to next step
        }

        // For other types, skip
        break;
      }
    }

    // Log execution summary
    await supabase.from('automation_executions').insert({
      flow_id: flowId,
      status: 'success',
      result: {
        type: 'mass_dispatch',
        audienceSize: audience.length,
        sent,
        failed,
        skipped,
        durationMs: Date.now() - startTime,
      },
    });

    console.log(`[dispatch] Complete: ${sent} sent, ${failed} failed, ${skipped} skipped in ${Date.now() - startTime}ms`);

    return new Response(JSON.stringify({
      success: true,
      audienceSize: audience.length,
      sent,
      failed,
      skipped,
      timedOut: Date.now() - startTime > MAX_RUNTIME_MS,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[dispatch] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
