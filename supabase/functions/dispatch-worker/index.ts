// dispatch-worker
// Stateless durable worker: claims a small lease of dispatch_recipients,
// sends them via Meta Graph API, marks done. Designed to be spawned in parallel.
//
// Unlike the legacy dispatch-mass-send, this function does NOT chain itself.
// The orchestrator (cron) decides when to spawn more workers. Lease + SKIP LOCKED
// guarantees no duplicate sends even when many workers run concurrently.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBlockedSuffixes, isBlocked } from "../_shared/blocked-guard.ts";


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH = 45;
const CONCURRENCY = 45;
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

// Distinct {{n}} numbers in a text, sorted ascending.
function extractVarNumbers(text?: string): number[] {
  if (!text) return [];
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  const nums = matches.map((m) => parseInt(m.replace(/[^\d]/g, ''), 10));
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

// Builds the Meta "carousel" send component from the approved template's CAROUSEL
// definition + the per-card weekly content stored in variablesConfig:
//   card_{i}_image       → image link for that week
//   card_{i}_body_{n}    → text variable value for the card body
//   card_{i}_button_url_{j} → URL suffix for a card's URL button with {{n}}
function buildCarouselComponent(
  carouselComp: any,
  variablesConfig: Record<string, VariableConfig>,
  dispatchId?: string,
): any {
  const tplCards = carouselComp?.cards || [];
  const cards = tplCards.map((tplCard: any, i: number) => {
    const cardComps: any[] = [];
    const imageUrl = variablesConfig[`card_${i}_image`]?.staticValue || '';
    cardComps.push({ type: 'header', parameters: [{ type: 'image', image: { link: imageUrl } }] });

    const cardBody = (tplCard.components || []).find((c: any) => (c.type || '').toUpperCase() === 'BODY');
    const bodyVars = extractVarNumbers(cardBody?.text);
    if (bodyVars.length > 0) {
      cardComps.push({
        type: 'body',
        parameters: bodyVars.map((n) => ({ type: 'text', text: variablesConfig[`card_${i}_body_${n}`]?.staticValue || '' })),
      });
    }

    const cardBtns = (tplCard.components || []).find((c: any) => (c.type || '').toUpperCase() === 'BUTTONS');
    (cardBtns?.buttons || []).forEach((b: any, idx: number) => {
      const btnType = (b.type || '').toUpperCase();
      if (btnType === 'URL' && (b.url || '').includes('{{')) {
        const suffix = variablesConfig[`card_${i}_button_url_${idx}`]?.staticValue || '';
        cardComps.push({ type: 'button', sub_type: 'url', index: idx.toString(), parameters: [{ type: 'text', text: suffix }] });
      } else if (btnType === 'QUICK_REPLY') {
        // Per-card payload so the webhook can identify exactly which card the customer tapped.
        // Format: bcq:<dispatchId>:<cardIndex>
        const payload = `bcq:${dispatchId || 'na'}:${i}`;
        cardComps.push({ type: 'button', sub_type: 'quick_reply', index: idx.toString(), parameters: [{ type: 'payload', payload }] });
      }
    });

    return { card_index: i, components: cardComps };
  });
  return { type: 'carousel', cards };
}

// Builds the resolved carousel structure (image + body + buttons per card) for
// storage in whatsapp_messages so the chat renders the full carousel.
function paramText(p: any): string {
  return typeof p?.text === 'string' ? p.text : '';
}
function buildCarouselPayloadForChat(
  templateComponents: any[],
  sentComponents: any[],
): any | null {
  const carouselDef = templateComponents.find((c: any) => (c.type || '').toUpperCase() === 'CAROUSEL');
  if (!carouselDef || !Array.isArray(carouselDef.cards)) return null;
  const sentCarousel = sentComponents.find((c: any) => (c.type || '').toLowerCase() === 'carousel');
  const sentCards: any[] = sentCarousel?.cards || [];

  const bodyDef = templateComponents.find((c: any) => (c.type || '').toUpperCase() === 'BODY');
  const sentBody = sentComponents.find((c: any) => (c.type || '').toLowerCase() === 'body');
  const subst = (text: string, params: any[]) =>
    (text || '').replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => paramText(params?.[parseInt(n, 10) - 1]) || `{{${n}}}`);
  const bubbleBody = bodyDef?.text ? subst(bodyDef.text, sentBody?.parameters || []) : '';

  const cards = carouselDef.cards.map((cardDef: any, i: number) => {
    const sentCard = sentCards.find((c: any) => c.card_index === i) || sentCards[i] || {};
    const comps: any[] = sentCard.components || [];
    const headerParams = comps.find((c: any) => (c.type || '').toLowerCase() === 'header')?.parameters || [];
    const hp = headerParams[0] || {};
    const cardBodyDef = (cardDef.components || []).find((c: any) => (c.type || '').toUpperCase() === 'BODY');
    const cardBodyParams = comps.find((c: any) => (c.type || '').toLowerCase() === 'body')?.parameters || [];
    const body = cardBodyDef?.text ? subst(cardBodyDef.text, cardBodyParams) : '';
    const btnsDef = (cardDef.components || []).find((c: any) => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || [];
    const buttons = btnsDef.map((b: any, idx: number) => {
      const type = (b.type || '').toUpperCase();
      let url = b.url || undefined;
      if (type === 'URL' && url && url.includes('{{')) {
        const sentBtn = comps.find((c: any) => (c.type || '').toLowerCase() === 'button' && (c.sub_type || '').toLowerCase() === 'url' && String(c.index) === String(idx));
        url = url.replace(/\{\{\d+\}\}/, paramText(sentBtn?.parameters?.[0]) || '');
      }
      return { type, text: b.text || '', url, phone_number: b.phone_number };
    });
    return { image_url: hp.image?.link || null, video_url: hp.video?.link || null, body, buttons };
  });

  return { type: 'carousel', body: bubbleBody, cards };
}

function buildComponentsForRecipient(
  templateComponents: any[],
  variablesConfig: Record<string, VariableConfig>,
  headerMediaUrl: string | null,
  recipient: any | null,
  hasDynamicVars: boolean,
  dispatchId?: string,
) {
  const components: any[] = [];

  // ── Carousel templates take a dedicated path ──
  const carouselComp = templateComponents.find((c: any) => (c.type || '').toUpperCase() === 'CAROUSEL');
  if (carouselComp) {
    // Bubble body (above the cards) variables, if any.
    const bubble = templateComponents.find((c: any) => (c.type || '').toUpperCase() === 'BODY');
    const bubbleVars = extractVarNumbers(bubble?.text);
    if (bubbleVars.length > 0) {
      const resolveBubble = (n: number) => {
        const vc = variablesConfig[`body_${n}`];
        if (!vc) return '';
        if (vc.mode === '__static__' || !hasDynamicVars || !recipient) return vc.staticValue || 'Cliente';
        return resolveVariable(vc, recipient) || 'Cliente';
      };
      components.push({ type: 'body', parameters: bubbleVars.map((n) => ({ type: 'text', text: resolveBubble(n) })) });
    }
    components.push(buildCarouselComponent(carouselComp, variablesConfig, dispatchId));
    return components;
  }

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

    // Detect a media header (IMAGE/VIDEO/DOCUMENT) so the chat record shows the
    // image/video/file that was actually sent with the template — not just text.
    const headerComp = templateComponents.find((c: any) => c.type === 'HEADER');
    const headerFormat = (headerComp?.format || 'TEXT').toUpperCase();
    const isMediaHeader = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat) && !!headerMediaUrl;
    const chatMediaType = isMediaHeader ? headerFormat.toLowerCase() : 'text';
    const chatMediaUrl = isMediaHeader ? headerMediaUrl : null;

    let totalSent = 0;
    let totalFailed = 0;
    let loops = 0;

    // Bloqueio cross-instância: contatos bloqueados em QUALQUER instância nunca
    // recebem disparo em massa. Carregado uma vez por execução do worker.
    const blockedSuffixes = await loadBlockedSuffixes(supabase);

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

      // Remove contatos bloqueados deste lote: marca como terminal ('blocked') para
      // não serem reenviados nem contarem como falha. Mutamos `claimed` no lugar
      // para manter o restante do fluxo intacto.
      if (blockedSuffixes.size > 0) {
        const blockedIds: string[] = [];
        for (let i = claimed.length - 1; i >= 0; i--) {
          if (isBlocked(blockedSuffixes, claimed[i].phone)) {
            blockedIds.push(claimed[i].id);
            claimed.splice(i, 1);
          }
        }
        if (blockedIds.length > 0) {
          await supabase.from('dispatch_recipients')
            .update({ status: 'blocked', last_error: 'contato bloqueado', lease_until: null })
            .in('id', blockedIds);
          console.log(`[${workerId}] ${blockedIds.length} destinatário(s) bloqueado(s) ignorado(s)`);
        }
        if (claimed.length === 0) continue;
      }


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

        const components = buildComponentsForRecipient(templateComponents, variablesConfig, headerMediaUrl, rcp, hasDynamicVars, dispatchId);
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

      // Persist outcomes using BULK operations to avoid exhausting the DB
      // connection pool (per-row UPDATEs + fire-and-forget inserts were the main
      // cause of the system-wide slowdown during mass dispatches).
      const persistOps: Promise<any>[] = [];

      // 1. Mark sent rows in a SINGLE statement (unnest of ids + wamids).
      if (sentRows.length > 0) {
        const ids = sentRows.map((s) => s.id);
        const wamids = sentRows.map((s) => s.wamid || '');
        persistOps.push(supabase.rpc('mark_dispatch_sent', { p_ids: ids, p_wamids: wamids }));

        // Log to whatsapp_messages in ONE batched insert (awaited, not orphaned).
        const messageRows = sentRows.map((s) => ({
          phone: s.phone,
          message: s.rendered || `[Template: ${dispatch.template_name}]`,
          direction: 'outgoing',
          message_id: s.wamid,
          status: 'sent',
          media_type: chatMediaType,
          media_url: chatMediaUrl,
          whatsapp_number_id: dispatch.whatsapp_number_id,
          is_mass_dispatch: true,
          source: 'broadcast',
        }));
        persistOps.push(supabase.from('whatsapp_messages').insert(messageRows));
      }

      // 2. Failed rows: exhausted attempts -> 'failed', otherwise back to 'pending'.
      const exhaustedIds = failedRows.map((f) => f.id);
      if (exhaustedIds.length > 0) {
        const firstErr = failedRows[0]?.error || 'unknown';
        persistOps.push(
          supabase.from('dispatch_recipients').update({
            status: 'failed', last_error: firstErr, lease_until: null,
          }).in('id', exhaustedIds).gte('attempts', 3),
        );
        persistOps.push(
          supabase.from('dispatch_recipients').update({
            status: 'pending', last_error: firstErr, lease_until: null,
          }).in('id', exhaustedIds).lt('attempts', 3),
        );
      }

      await Promise.all(persistOps);

      totalSent += sentRows.length;
      totalFailed += failedRows.length;

      // Push a monotonic count refresh after every batch so the UI advances
      // smoothly during the run instead of only when the worker finishes.
      await supabase.rpc('refresh_dispatch_counts', { p_dispatch_id: dispatchId });
    }

    // Refresh aggregate counts ATOMICALLY and MONOTONICALLY. Previously each worker
    // ran its own COUNT then overwrote sent_count — a worker holding an older (lower)
    // snapshot could land its UPDATE after a worker with a higher count, regressing the
    // value. That race made the UI progress flap/reset (400 -> 0 -> 430 -> 0 -> 480).
    // refresh_dispatch_counts() counts + updates in a single statement using GREATEST,
    // so sent_count/failed_count can only ever go UP. Finalization stays owned by the
    // cron RPC finalize_completed_dispatches().
    await supabase.rpc('refresh_dispatch_counts', { p_dispatch_id: dispatchId });

    return new Response(JSON.stringify({
      workerId, loops, sent: totalSent, failed: totalFailed,
      elapsedMs: Date.now() - startedAt,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error(`[${workerId}] fatal:`, err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
