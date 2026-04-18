import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 60;
const CONCURRENCY = 8;
const MAX_EXECUTION_MS = 25_000; // 25s safety margin
const CHUNK_DELAY_MS = 600;

interface VariableConfig {
  mode: string;
  staticValue: string;
}

function resolveVariable(vc: VariableConfig, recipient: any): string {
  switch (vc.mode) {
    case '__first_name__': return recipient.first_name || (recipient.recipient_name || '').split(' ')[0] || 'Cliente';
    case '__full_name__': return recipient.recipient_name || 'Cliente';
    case '__phone__': return recipient.phone || '';
    case '__city__': return recipient.city || 'N/A';
    case '__state__': return recipient.state || 'N/A';
    case '__segment__': return recipient.segment || 'N/A';
    case '__email__': return recipient.email || 'N/A';
    default: return vc.staticValue || 'Cliente';
  }
}

function buildComponentsForRecipient(
  templateComponents: any[],
  variablesConfig: Record<string, VariableConfig>,
  headerMediaUrl: string | null,
  recipient: any | null,
  hasDynamicVars: boolean
) {
  const components: any[] = [];
  const bodyVars: { index: number; key: string }[] = [];
  const headerVars: { index: number; key: string }[] = [];
  const headerComp = templateComponents.find((c: any) => c.type === 'HEADER');
  const buttonsComp = templateComponents.find((c: any) => c.type === 'BUTTONS');

  for (const comp of templateComponents) {
    if (comp.text) {
      const matches = [...comp.text.matchAll(/\{\{(\d+)\}\}/g)];
      for (const m of matches) {
        const key = `${comp.type.toLowerCase()}_${m[1]}`;
        if (comp.type === 'BODY') bodyVars.push({ index: parseInt(m[1]), key });
        if (comp.type === 'HEADER') headerVars.push({ index: parseInt(m[1]), key });
      }
    }
  }

  const resolve = (key: string) => {
    const vc = variablesConfig[key];
    if (!vc) return '';
    if (vc.mode === '__static__') return vc.staticValue || 'Cliente';
    if (!recipient || !hasDynamicVars) return vc.staticValue || 'Cliente';
    return resolveVariable(vc, recipient) || 'Cliente';
  };

  if (headerComp && headerComp.format && headerComp.format !== 'TEXT' && headerMediaUrl) {
    const mediaType = headerComp.format.toLowerCase();
    components.push({
      type: 'header',
      parameters: [{ type: mediaType, [mediaType]: { link: headerMediaUrl } }],
    });
  } else if (headerVars.length > 0) {
    components.push({
      type: 'header',
      parameters: headerVars.map(v => ({ type: 'text', text: resolve(v.key) })),
    });
  }

  if (bodyVars.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyVars.map(v => ({ type: 'text', text: resolve(v.key) })),
    });
  }

  const urlButtons = (buttonsComp?.buttons || []).filter((b: any) => b.type === 'URL' && b.url?.includes('{{'));
  urlButtons.forEach((btn: any, idx: number) => {
    const suffix = variablesConfig[`button_url_${idx}`]?.staticValue || '';
    if (suffix) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: idx.toString(),
        parameters: [{ type: 'text', text: suffix }],
      });
    }
  });

  return components;
}

function buildRenderedMessage(
  templateComponents: any[],
  variablesConfig: Record<string, VariableConfig>,
  recipient: any | null,
  hasDynamicVars: boolean
): string {
  const parts: string[] = [];
  for (const comp of templateComponents) {
    if (comp.type === 'HEADER' && comp.text) {
      let text = comp.text;
      text = text.replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => {
        const vc = variablesConfig[`header_${n}`];
        if (!vc) return `{{${n}}}`;
        if (vc.mode === '__static__' || !hasDynamicVars || !recipient) return vc.staticValue || '';
        return resolveVariable(vc, recipient);
      });
      parts.push(`*${text}*`);
    }
    if (comp.type === 'BODY' && comp.text) {
      let text = comp.text;
      text = text.replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => {
        const vc = variablesConfig[`body_${n}`];
        if (!vc) return `{{${n}}}`;
        if (vc.mode === '__static__' || !hasDynamicVars || !recipient) return vc.staticValue || '';
        return resolveVariable(vc, recipient);
      });
      parts.push(text);
    }
    if (comp.type === 'FOOTER' && comp.text) {
      parts.push(`_${comp.text}_`);
    }
  }
  return parts.join('\n\n');
}

async function getRecipientCounts(supabase: ReturnType<typeof createClient>, dispatchId: string) {
  const [{ count: sentCount }, { count: failedCount }, { count: pendingCount }] = await Promise.all([
    supabase.from('dispatch_recipients').select('*', { count: 'exact', head: true })
      .eq('dispatch_id', dispatchId).eq('status', 'sent'),
    supabase.from('dispatch_recipients').select('*', { count: 'exact', head: true })
      .eq('dispatch_id', dispatchId).eq('status', 'failed'),
    supabase.from('dispatch_recipients').select('*', { count: 'exact', head: true })
      .eq('dispatch_id', dispatchId).eq('status', 'pending'),
  ]);

  return {
    sentCount: sentCount || 0,
    failedCount: failedCount || 0,
    pendingCount: pendingCount || 0,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { dispatchId } = await req.json();
    if (!dispatchId) {
      return new Response(JSON.stringify({ error: 'dispatchId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load dispatch record — single lean query
    const { data: dispatch, error: dispErr } = await supabase
      .from('dispatch_history')
      .select('id,status,template_name,template_language,template_components,variables_config,has_dynamic_vars,header_media_url,whatsapp_number_id,processing_batch,started_at,created_at')
      .eq('id', dispatchId)
      .single();

    if (dispErr || !dispatch) {
      return new Response(JSON.stringify({ error: 'Dispatch not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (dispatch.status === 'cancelled' || dispatch.status === 'paused' || dispatch.status === 'completed') {
      return new Response(JSON.stringify({ success: true, message: `Dispatch is ${dispatch.status}` }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Stale lock detection: if processing_batch is true, check if we should wait or force release
    if (dispatch.processing_batch) {
      // Use created_at of the dispatch as fallback — but really we track via the lock timestamp below
      const lockAge = Date.now() - new Date(dispatch.started_at || dispatch.created_at).getTime();
      // Only force release after 120s to avoid conflicts
      if (lockAge < 120_000) {
        return new Response(JSON.stringify({ success: true, message: 'Another batch is processing' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log(`Stale lock detected (${Math.round(lockAge/1000)}s), forcing release`);
    }

    // Acquire lock — use started_at as lock timestamp (column exists)
    const { error: lockErr } = await supabase
      .from('dispatch_history')
      .update({ processing_batch: true, started_at: new Date().toISOString() })
      .eq('id', dispatchId);

    if (lockErr) {
      console.error('Failed to acquire lock:', lockErr);
      return new Response(JSON.stringify({ error: 'Failed to acquire lock' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check time budget after lock
    if (Date.now() - startTime > MAX_EXECUTION_MS) {
      await supabase.from('dispatch_history').update({ processing_batch: false }).eq('id', dispatchId);
      return new Response(JSON.stringify({ success: true, message: 'No time budget left' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get credentials
    let phoneNumberId = '', accessToken = '';
    if (dispatch.whatsapp_number_id) {
      const { data: numData } = await supabase
        .from('whatsapp_numbers')
        .select('phone_number_id, access_token')
        .eq('id', dispatch.whatsapp_number_id)
        .eq('is_active', true)
        .maybeSingle();
      if (numData) {
        phoneNumberId = numData.phone_number_id;
        accessToken = numData.access_token;
      }
    }
    if (!accessToken) {
      const { data: defNum } = await supabase
        .from('whatsapp_numbers')
        .select('phone_number_id, access_token')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      if (defNum) {
        phoneNumberId = defNum.phone_number_id;
        accessToken = defNum.access_token;
      }
    }

    if (!accessToken || !phoneNumberId) {
      await supabase.from('dispatch_history').update({
        processing_batch: false, status: 'failed',
      }).eq('id', dispatchId);
      return new Response(JSON.stringify({ error: 'No WhatsApp credentials' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check time budget after credentials
    if (Date.now() - startTime > MAX_EXECUTION_MS) {
      await supabase.from('dispatch_history').update({ processing_batch: false }).eq('id', dispatchId);
      scheduleNextBatch(supabaseUrl, supabaseKey, dispatchId);
      return new Response(JSON.stringify({ success: true, message: 'Setup took too long, rechaining' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const graphUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const templateComponents = dispatch.template_components || [];
    const variablesConfig = dispatch.variables_config || {};
    const hasDynamicVars = dispatch.has_dynamic_vars || false;
    const headerMediaUrl = dispatch.header_media_url || null;

    // Fetch pending recipients batch
    const { data: pendingRecipients, error: pendErr } = await supabase
      .from('dispatch_recipients')
      .select('id,phone,recipient_name')
      .eq('dispatch_id', dispatchId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (pendErr) {
      console.error('Error fetching recipients:', pendErr);
      await supabase.from('dispatch_history').update({ processing_batch: false }).eq('id', dispatchId);
      return new Response(JSON.stringify({ error: 'Failed to fetch recipients' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!pendingRecipients || pendingRecipients.length === 0) {
      const { sentCount, failedCount } = await getRecipientCounts(supabase, dispatchId);

      const { error: completeErr } = await supabase.from('dispatch_history').update({
        processing_batch: false,
        status: 'completed',
        completed_at: new Date().toISOString(),
        sent_count: sentCount,
        failed_count: failedCount,
      }).eq('id', dispatchId);

      if (completeErr) {
        console.error('Failed to finalize dispatch counts:', completeErr);
      }

      return new Response(JSON.stringify({ success: true, message: 'Dispatch completed', sentCount, failedCount }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Enrich recipients with WhatsApp display_name (prioritize over CRM name)
    // Build phone variations to match chat_contacts (with/without 55, with/without 9th digit)
    const phoneVariations: string[] = [];
    for (const r of pendingRecipients) {
      const digits = r.phone.replace(/\D/g, '');
      phoneVariations.push(digits);
      if (digits.startsWith('55')) phoneVariations.push(digits.slice(2));
      else phoneVariations.push('55' + digits);
    }
    const { data: chatContacts } = await supabase
      .from('chat_contacts')
      .select('phone, display_name, custom_name')
      .in('phone', phoneVariations);

    // Build a suffix -> display_name map from chat_contacts
    const whatsappNameMap = new Map<string, string>();
    if (chatContacts) {
      for (const cc of chatContacts) {
        if (!cc.phone || (!cc.display_name && !cc.custom_name)) continue;
        const suffix = cc.phone.replace(/\D/g, '').slice(-8);
        whatsappNameMap.set(suffix, cc.custom_name || cc.display_name);
      }
    }

    // Override recipient names when WhatsApp display_name exists
    for (const r of pendingRecipients) {
      const suffix = r.phone.replace(/\D/g, '').slice(-8);
      const waName = whatsappNameMap.get(suffix);
      if (waName && waName.trim()) {
        // Set first_name from WhatsApp display name
        (r as any).first_name = waName.split(' ')[0];
        (r as any).recipient_name = waName;
      }
    }

    // Process batch
    let batchSent = 0, batchFailed = 0;
    const sentIds: { id: string; wamid: string | null; phone: string; rendered: string }[] = [];
    const failedIds: string[] = [];

    async function sendOne(recipient: any): Promise<{ ok: boolean; id: string; wamid?: string; phone?: string; rendered?: string }> {
      let formattedPhone = recipient.phone.replace(/\D/g, '');
      if (!formattedPhone.startsWith('55')) formattedPhone = '55' + formattedPhone;

      const components = buildComponentsForRecipient(
        templateComponents, variablesConfig, headerMediaUrl, recipient, hasDynamicVars
      );
      const rendered = buildRenderedMessage(
        templateComponents, variablesConfig, hasDynamicVars ? recipient : null, hasDynamicVars
      );

      const templateBody: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'template',
        template: {
          name: dispatch.template_name,
          language: { code: dispatch.template_language || 'pt_BR' },
        },
      };

      if (components.length > 0) {
        (templateBody.template as Record<string, unknown>).components = components;
      }

      try {
        const response = await fetch(graphUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(templateBody),
        });

        const data = await response.json();

        if (response.ok) {
          const messageId = data.messages?.[0]?.id || null;
          return { ok: true, id: recipient.id, wamid: messageId, phone: formattedPhone, rendered };
        } else {
          console.error(`Failed ${formattedPhone}:`, data.error?.message || JSON.stringify(data));
          return { ok: false, id: recipient.id };
        }
      } catch (sendErr) {
        console.error(`Error ${formattedPhone}:`, sendErr);
        return { ok: false, id: recipient.id };
      }
    }

    // Process in chunks, checking timeout each chunk
    for (let i = 0; i < pendingRecipients.length; i += CONCURRENCY) {
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        console.log(`Timeout guard hit after ${batchSent + batchFailed} sends`);
        break;
      }

      const chunk = pendingRecipients.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(r => sendOne(r)));
      for (const r of results) {
        if (r.ok) {
          batchSent++;
          sentIds.push({ id: r.id, wamid: r.wamid || null, phone: r.phone!, rendered: r.rendered! });
        } else {
          batchFailed++;
          failedIds.push(r.id);
        }
      }

      // Small delay between chunks to avoid Meta rate limits
      if (i + CONCURRENCY < pendingRecipients.length) {
        await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS));
      }
    }

    // Batch DB updates in chunks of 20
    const dbWrites: Promise<any>[] = [];
    for (const s of sentIds) {
      dbWrites.push(
        supabase.from('dispatch_recipients').update({ status: 'sent', message_wamid: s.wamid }).eq('id', s.id)
      );
    }
    for (const fid of failedIds) {
      dbWrites.push(
        supabase.from('dispatch_recipients').update({ status: 'failed' }).eq('id', fid)
      );
    }
    for (let i = 0; i < dbWrites.length; i += 20) {
      await Promise.all(dbWrites.slice(i, i + 20));
    }

    // Fire and forget message inserts
    for (const s of sentIds) {
      supabase.from('whatsapp_messages').insert({
        phone: s.phone,
        message: s.rendered || `[Template: ${dispatch.template_name}]`,
        direction: 'outgoing',
        message_id: s.wamid,
        status: 'sent',
        media_type: 'text',
        whatsapp_number_id: dispatch.whatsapp_number_id,
        is_mass_dispatch: true,
      }).then(() => {});
    }

    const { sentCount: totalSent, failedCount: totalFailed, pendingCount: totalPending } = await getRecipientCounts(supabase, dispatchId);

    const nextStatus = totalPending > 0 ? dispatch.status : 'completed';
    const completedAt = totalPending > 0 ? null : new Date().toISOString();
    const { error: progressErr } = await supabase.from('dispatch_history').update({
      processing_batch: false,
      status: nextStatus,
      completed_at: completedAt,
      sent_count: totalSent,
      failed_count: totalFailed,
    }).eq('id', dispatchId);

    if (progressErr) {
      console.error('Failed to persist dispatch progress:', progressErr, { dispatchId, totalSent, totalFailed, totalPending });
    }

    if (totalPending > 0) {
      const { data: checkStatus } = await supabase
        .from('dispatch_history').select('status').eq('id', dispatchId).single();

      if (checkStatus?.status !== 'cancelled' && checkStatus?.status !== 'paused') {
        scheduleNextBatch(supabaseUrl, supabaseKey, dispatchId);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      batchSent,
      batchFailed,
      totalPending: totalPending || 0,
      totalSent: totalSent || 0,
      totalFailed: totalFailed || 0,
      elapsedMs: Date.now() - startTime,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('dispatch-mass-send error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function scheduleNextBatch(supabaseUrl: string, supabaseKey: string, dispatchId: string) {
  // Chain immediately — no setTimeout to avoid losing the call on shutdown
  const nextUrl = `${supabaseUrl}/functions/v1/dispatch-mass-send`;
  void fetch(nextUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
    },
    body: JSON.stringify({ dispatchId }),
  }).catch(err => console.error('Failed to chain next batch:', err));
}
