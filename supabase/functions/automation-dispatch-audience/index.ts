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

function buildAudience(
  rfmData: any[],
  leadsData: any[],
  filters: { selectedStates: string[]; selectedCities: string[]; selectedRegions: string[]; selectedGenders: string[] },
  seenPhones: Set<string>
): Array<{ phone: string; name: string; email?: string; city?: string; state?: string }> {
  const audience: Array<{ phone: string; name: string; email?: string; city?: string; state?: string }> = [];

  for (const row of rfmData) {
    if (!row.phone) continue;
    if (filters.selectedStates.length > 0 && !filters.selectedStates.includes(row.state)) continue;
    if (filters.selectedCities.length > 0 && !filters.selectedCities.includes(row.city)) continue;
    if (filters.selectedRegions.length > 0 && !filters.selectedRegions.includes(row.region_type)) continue;
    if (filters.selectedGenders.length > 0 && !filters.selectedGenders.includes(row.gender)) continue;
    const phone = normalizePhone(row.phone);
    if (phone.length < 12 || seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Cliente';
    audience.push({ phone, name: fullName, email: row.email, city: row.city, state: row.state });
  }

  for (const row of leadsData) {
    if (!row.phone) continue;
    const phone = normalizePhone(row.phone);
    if (phone.length < 12 || seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    audience.push({ phone, name: row.name || 'Cliente', email: row.email });
  }

  return audience;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const MAX_RUNTIME_MS = 50000;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { flowId, dryRun, offset = 0, batchSize = 2000 } = await req.json();

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
    const presetKeys = (triggerConfig.audience_rfm_preset_keys as string[]) || [];

    // Fetch already-sent phones for this flow to avoid duplicates
    const alreadySentRows = await fetchAllRows(supabase, 'automation_dispatch_sent', 'phone', { flow_id: [flowId] });
    const seenPhones = new Set<string>(alreadySentRows.map((r: any) => r.phone));
    const alreadySentCount = seenPhones.size;
    console.log(`[dispatch] Already sent to ${alreadySentCount} phones for this flow`);

    let rfmData: any[] = [];
    let leadsData: any[] = [];

    // If preset keys are selected, load all RFM customers and filter by presets
    const presetFilters: any[] = [];
    if (presetKeys.length > 0 && (audienceSource === 'rfm' || audienceSource === 'both')) {
      const { data: presetRows } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', presetKeys);
      if (presetRows) {
        for (const p of presetRows) {
          const f = (p.value as any)?.filters || p.value;
          if (f) presetFilters.push(f);
        }
      }
      console.log(`[dispatch] Using ${presetFilters.length} saved RFM preset filter(s)`);
      // Fetch all customers when using presets (filtering happens in-memory)
      rfmData = await fetchAllRows(supabase, 'zoppy_customers', 'phone, first_name, last_name, email, city, state, rfm_segment, region_type, gender, ddd, avg_ticket, total_orders, last_purchase_at, rfm_recency_score');
    } else if (audienceSource === 'rfm' || audienceSource === 'both' || audienceSource === 'crm') {
      if (audienceSource === 'crm' || rfmSelectAll) {
        rfmData = await fetchAllRows(supabase, 'zoppy_customers', 'phone, first_name, last_name, email, city, state, rfm_segment, region_type, gender');
      } else if (selectedRfmSegments.length > 0) {
        rfmData = await fetchAllRows(supabase, 'zoppy_customers', 'phone, first_name, last_name, email, city, state, rfm_segment, region_type, gender', {
          rfm_segment: selectedRfmSegments,
        });
      }
    }

    if (audienceSource === 'leads' || audienceSource === 'both') {
      if (selectedCampaigns.length > 0) {
        leadsData = await fetchAllRows(supabase, 'lp_leads', 'phone, name, email, campaign_tag', {
          campaign_tag: selectedCampaigns,
        });
      } else {
        leadsData = await fetchAllRows(supabase, 'lp_leads', 'phone, name, email, campaign_tag');
      }
    }

    // Apply preset filters if present
    if (presetFilters.length > 0) {
      rfmData = rfmData.filter(c => {
        return presetFilters.some(f => {
          if (f.rfmFilter && f.rfmFilter !== 'all' && c.rfm_segment !== f.rfmFilter) return false;
          if (f.recencyFilter && f.recencyFilter !== 'all' && (c.rfm_recency_score || 0) !== parseInt(f.recencyFilter)) return false;
          if (f.regionFilter && f.regionFilter !== 'all' && c.region_type !== f.regionFilter) return false;
          if (f.dddFilter && f.dddFilter !== 'all' && c.ddd !== f.dddFilter) return false;
          if (f.dateFrom && c.last_purchase_at && c.last_purchase_at < f.dateFrom) return false;
          if (f.dateTo && c.last_purchase_at && c.last_purchase_at > f.dateTo + 'T23:59:59') return false;
          if ((f.dateFrom || f.dateTo) && !c.last_purchase_at) return false;
          if (f.ticketMin && (c.avg_ticket || 0) < parseFloat(f.ticketMin)) return false;
          if (f.ticketMax && (c.avg_ticket || 0) > parseFloat(f.ticketMax)) return false;
          if (f.ordersMin && (c.total_orders || 0) < parseInt(f.ordersMin)) return false;
          if (f.ordersMax && (c.total_orders || 0) > parseInt(f.ordersMax)) return false;
          return true;
        });
      });
      console.log(`[dispatch] After preset filtering: ${rfmData.length} customers`);
    }

    const filters = { selectedStates: presetFilters.length > 0 ? [] : selectedStates, selectedCities: presetFilters.length > 0 ? [] : selectedCities, selectedRegions: presetFilters.length > 0 ? [] : selectedRegions, selectedGenders: presetFilters.length > 0 ? [] : selectedGenders };
    const fullAudience = buildAudience(rfmData, leadsData, filters, seenPhones);
    const totalAudience = fullAudience.length;

    console.log(`[dispatch] New audience (after dedup): ${totalAudience}, offset: ${offset}, batchSize: ${batchSize}`);

    // Dry run: return counts
    if (dryRun) {
      return new Response(JSON.stringify({ success: true, audienceCount: totalAudience, alreadySent: alreadySentCount }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Slice audience for this batch
    const batch = fullAudience.slice(offset, offset + batchSize);

    if (batch.length === 0) {
      return new Response(JSON.stringify({
        success: true, sent: 0, failed: 0, skipped: 0,
        totalAudience, nextOffset: null, done: true,
      }), {
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

    const defaultNumberId = whatsappInstances.length > 0 ? whatsappInstances[0] : null;
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const CONCURRENCY = 50;

    async function processRecipient(recipient: typeof batch[0]): Promise<void> {
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

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const config = step.action_config as Record<string, unknown> || {};
        const sendNumberId = (config.whatsappNumberId as string) || defaultNumberId;

        if (step.action_type === 'delay') continue;
        if (step.action_type === 'wait_for_reply') {
          const timeoutHours = (config.timeoutHours as number) || 24;
          const expiresAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000).toISOString();
          await supabase.from('automation_pending_replies').insert({
            phone: recipient.phone,
            flow_id: flowId,
            pending_step_index: i,
            step_id: step.id,
            button_branches: config.timeoutAction ? { __timeout_action__: config.timeoutAction, __timeout_message__: config.timeoutMessage || '', __timeout_template__: config.timeoutTemplateName || '', __timeout_tag__: config.timeoutTag || '' } : {},
            whatsapp_number_id: sendNumberId || null,
            recipient_data: { name: recipient.name, firstName, email: recipient.email, city: recipient.city, state: recipient.state },
            expires_at: expiresAt,
          });
          console.log(`[dispatch] Created pending reply (wait_for_reply) at step ${i} for ${recipient.phone}, expires: ${expiresAt}`);
          break;
        }

        if (step.action_type === 'send_template') {
          const templateName = config.templateName as string;
          if (!templateName) { skipped++; break; }

          const components: unknown[] = [];

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
              await supabase.from('automation_dispatch_sent').upsert({ flow_id: flowId, phone: recipient.phone }, { onConflict: 'flow_id,phone' });
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
            } else {
              failed++;
              if (failed <= 3) {
                const errData = await sendRes.json().catch(() => ({}));
                console.error(`[dispatch] Failed for ${recipient.phone}:`, errData);
              }
            }
          } catch (e) {
            failed++;
          }

          break;
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
            if (sendRes.ok) {
              sent++;
              await supabase.from('automation_dispatch_sent').upsert({ flow_id: flowId, phone: recipient.phone }, { onConflict: 'flow_id,phone' });
            }
            else failed++;
          } catch {
            failed++;
          }

          break;
        }

        if (step.action_type === 'add_tag') continue;
        break;
      }
    }

    // Process batch with concurrency pool
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log(`[dispatch] Time limit hit at chunk starting ${offset + i}`);
        break;
      }
      const chunk = batch.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(r => processRecipient(r)));
      console.log(`[dispatch] Chunk done: ${i + chunk.length}/${batch.length}, sent=${sent}, failed=${failed}`);
    }

    const processed = sent + failed + skipped;
    const nextOffset = offset + processed;
    const done = nextOffset >= totalAudience;

    // Log only on last batch or periodically
    if (done || offset === 0) {
      await supabase.from('automation_executions').insert({
        flow_id: flowId,
        status: 'success',
        result: {
          type: 'mass_dispatch_batch',
          totalAudience,
          batchOffset: offset,
          sent,
          failed,
          skipped,
          durationMs: Date.now() - startTime,
          done,
        },
      });
    }

    console.log(`[dispatch] Batch done: offset=${offset}, sent=${sent}, failed=${failed}, next=${nextOffset}, done=${done}, ${Date.now() - startTime}ms`);

    return new Response(JSON.stringify({
      success: true,
      totalAudience,
      sent,
      failed,
      skipped,
      nextOffset: done ? null : nextOffset,
      done,
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
