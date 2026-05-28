// dispatch-worker
// Stateless durable worker: claims a small lease of dispatch_recipients,
// sends them via Meta Graph API, marks done. Designed to be spawned in parallel.
//
// Unlike the legacy dispatch-mass-send, this function does NOT chain itself.
// The orchestrator (cron) decides when to spawn more workers. Lease + SKIP LOCKED
// guarantees no duplicate sends even when many workers run concurrently.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH = 20;
const CONCURRENCY = 20;
const MAX_RUNTIME_MS = 50_000; // safely under 60s edge timeout
const LEASE_SECONDS = 90;

interface VariableConfig { mode: string; staticValue: string; }

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
  hasDynamicVars: boolean,
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
  hasDynamicVars: boolean,
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const workerId = `w_${crypto.randomUUID().slice(0, 8)}`;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { dispatchId } = await req.json().catch(() => ({}));
    if (!dispatchId) {
      return new Response(JSON.stringify({ error: 'dispatchId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load dispatch metadata once
    const { data: dispatch, error: dispErr } = await supabase
      .from('dispatch_history')
      .select('id,status,template_name,template_language,template_components,variables_config,has_dynamic_vars,header_media_url,whatsapp_number_id')
      .eq('id', dispatchId)
      .single();

    if (dispErr || !dispatch) {
      return new Response(JSON.stringify({ error: 'Dispatch not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (['cancelled', 'paused', 'completed', 'failed'].includes(dispatch.status)) {
      return new Response(JSON.stringify({ skipped: true, status: dispatch.status }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve WhatsApp credentials
    let phoneNumberId = '', accessToken = '';
    if (dispatch.whatsapp_number_id) {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('phone_number_id, access_token')
        .eq('id', dispatch.whatsapp_number_id)
        .eq('is_active', true)
        .maybeSingle();
      if (data) { phoneNumberId = data.phone_number_id; accessToken = data.access_token; }
    }
    if (!accessToken) {
      const { data } = await supabase
        .from('whatsapp_numbers')
        .select('phone_number_id, access_token')
        .eq('is_default', true).eq('is_active', true).maybeSingle();
      if (data) { phoneNumberId = data.phone_number_id; accessToken = data.access_token; }
    }
    if (!accessToken || !phoneNumberId) {
      return new Response(JSON.stringify({ error: 'No WhatsApp credentials' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const graphUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const templateComponents = dispatch.template_components || [];
    const variablesConfig = dispatch.variables_config || {};
    const hasDynamicVars = dispatch.has_dynamic_vars || false;
    const headerMediaUrl = dispatch.header_media_url || null;

    let totalSent = 0;
    let totalFailed = 0;
    let loops = 0;

    // Main loop: claim → send → mark, until time runs out or queue empty
    while (Date.now() - startedAt < MAX_RUNTIME_MS) {
      loops++;
      const { data: claimed, error: claimErr } = await supabase.rpc('claim_dispatch_jobs', {
        p_dispatch_id: dispatchId,
        p_worker_id: workerId,
        p_batch_size: BATCH,
        p_lease_seconds: LEASE_SECONDS,
      });

      if (claimErr) {
        console.error(`[${workerId}] claim error:`, claimErr);
        break;
      }
      if (!claimed || claimed.length === 0) break;

      // Enrich with WhatsApp display names (priority over CRM name)
      const variations: string[] = [];
      for (const r of claimed) {
        const d = (r.phone || '').replace(/\D/g, '');
        variations.push(d);
        variations.push(d.startsWith('55') ? d.slice(2) : '55' + d);
      }
      const { data: chatContacts } = await supabase
        .from('chat_contacts').select('phone, display_name, custom_name').in('phone', variations);
      const waNames = new Map<string, string>();
      for (const c of chatContacts || []) {
        if (!c.phone || (!c.display_name && !c.custom_name)) continue;
        waNames.set(c.phone.replace(/\D/g, '').slice(-8), c.custom_name || c.display_name);
      }
      for (const r of claimed) {
        const sfx = (r.phone || '').replace(/\D/g, '').slice(-8);
        const wa = waNames.get(sfx);
        if (wa && wa.trim()) {
          (r as any).first_name = wa.split(' ')[0];
          (r as any).recipient_name = wa;
        }
      }

      async function sendOne(rcp: any) {
        let formatted = rcp.phone.replace(/\D/g, '');
        if (!formatted.startsWith('55')) formatted = '55' + formatted;

        const components = buildComponentsForRecipient(templateComponents, variablesConfig, headerMediaUrl, rcp, hasDynamicVars);
        const rendered = buildRenderedMessage(templateComponents, variablesConfig, hasDynamicVars ? rcp : null, hasDynamicVars);
        const body: any = {
          messaging_product: 'whatsapp',
          to: formatted,
          type: 'template',
          template: { name: dispatch.template_name, language: { code: dispatch.template_language || 'pt_BR' } },
        };
        if (components.length > 0) body.template.components = components;

        try {
          const res = await fetch(graphUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (res.ok) {
            return { ok: true, id: rcp.id, wamid: data.messages?.[0]?.id || null, phone: formatted, rendered };
          }
          return { ok: false, id: rcp.id, error: data.error?.message || JSON.stringify(data).slice(0, 200) };
        } catch (e) {
          return { ok: false, id: rcp.id, error: String(e).slice(0, 200) };
        }
      }

      // Send in parallel chunks
      const sentRows: any[] = [];
      const failedRows: any[] = [];
      for (let i = 0; i < claimed.length; i += CONCURRENCY) {
        const chunk = claimed.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(chunk.map(sendOne));
        for (const r of results) {
          if (r.status === 'fulfilled') {
            if (r.value.ok) sentRows.push(r.value); else failedRows.push(r.value);
          }
        }
      }

      // Persist outcomes in parallel batches
      const writes: Promise<any>[] = [];
      for (const s of sentRows) {
        writes.push(
          supabase.from('dispatch_recipients').update({
            status: 'sent', message_wamid: s.wamid, sent_at: new Date().toISOString(), lease_until: null,
          }).eq('id', s.id),
        );
        // Side-effect: log to whatsapp_messages (fire-and-forget)
        supabase.from('whatsapp_messages').insert({
          phone: s.phone,
          message: s.rendered || `[Template: ${dispatch.template_name}]`,
          direction: 'outgoing',
          message_id: s.wamid,
          status: 'sent',
          media_type: 'text',
          whatsapp_number_id: dispatch.whatsapp_number_id,
          is_mass_dispatch: true,
          source: 'broadcast',
        }).then(() => {});
      }
      for (const f of failedRows) {
        // The claim already incremented attempts; mark as failed only if exhausted
        writes.push(
          supabase.from('dispatch_recipients').update({
            status: 'failed', last_error: f.error || 'unknown', lease_until: null,
          }).eq('id', f.id).gte('attempts', 3),
        );
        // Otherwise return to pending so another worker can retry
        writes.push(
          supabase.from('dispatch_recipients').update({
            status: 'pending', last_error: f.error || 'unknown', lease_until: null,
          }).eq('id', f.id).lt('attempts', 3),
        );
      }
      for (let i = 0; i < writes.length; i += 30) await Promise.all(writes.slice(i, i + 30));

      totalSent += sentRows.length;
      totalFailed += failedRows.length;
    }

    // Refresh aggregate counts (single query each)
    const [{ count: sCount }, { count: fCount }, { count: pCount }] = await Promise.all([
      supabase.from('dispatch_recipients').select('*', { count: 'exact', head: true })
        .eq('dispatch_id', dispatchId).in('status', ['sent', 'delivered', 'read']),
      supabase.from('dispatch_recipients').select('*', { count: 'exact', head: true })
        .eq('dispatch_id', dispatchId).eq('status', 'failed'),
      supabase.from('dispatch_recipients').select('*', { count: 'exact', head: true })
        .eq('dispatch_id', dispatchId).in('status', ['pending', 'leased']),
    ]);

    const isDone = (pCount || 0) === 0;
    await supabase.from('dispatch_history').update({
      sent_count: sCount || 0,
      failed_count: fCount || 0,
      ...(isDone ? { status: 'completed', completed_at: new Date().toISOString(), processing_batch: false } : {}),
    }).eq('id', dispatchId);

    return new Response(JSON.stringify({
      workerId, loops, sent: totalSent, failed: totalFailed,
      totalSent: sCount, totalFailed: fCount, totalPending: pCount,
      elapsedMs: Date.now() - startedAt,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error(`[${workerId}] fatal:`, err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
