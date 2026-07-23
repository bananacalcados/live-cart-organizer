import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizePhoneBR(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10) {
    // 9th digit injection (mobile only)
    d = d.slice(0, 2) + '9' + d.slice(2);
  }
  if (d.length !== 11) {
    // accept as-is if not matching; downstream validation will surface
  }
  return '55' + d;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const {
      event_id,
      source,           // 'lp' | 'typebot' | 'live_comment'
      landing_page_id,
      typebot_id,
      slug,
      name,
      phone,
      instagram,        // @ do Instagram (captação via comentário da live)
      ref_token,
      utm_source,
      utm_medium,
      utm_campaign,
      metadata,
      custom_fields,    // { field_key: value } — respostas de perguntas customizadas do typebot
      disqualified,     // true quando o lead não atendeu a condição da pergunta
    } = body || {};

    if (!event_id || !source || !name || !phone) {
      return new Response(JSON.stringify({ error: 'event_id, source, name and phone are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cf = (custom_fields && typeof custom_fields === 'object' && !Array.isArray(custom_fields))
      ? custom_fields
      : {};
    const isDisq = disqualified === true;

    // Se o lead foi desqualificado e não pediu para gravar, apenas retorna ok sem tocar no banco.
    // (O front controla o `disqualified` — se ele mandar true, é porque o admin marcou "gravar mesmo assim".)
    // Quando o admin não marca, o front nem chama esta função.


    const cleanName = String(name).trim().slice(0, 120);
    const e164 = normalizePhoneBR(phone);

    // Resolve referrer
    let referred_by_lead_id: string | null = null;
    let referrer_name: string | null = null;
    if (ref_token) {
      const { data: ref } = await supabase
        .from('event_leads')
        .select('id, name, event_id')
        .eq('referral_token', String(ref_token))
        .maybeSingle();
      if (ref && ref.event_id === event_id) {
        referred_by_lead_id = ref.id;
        referrer_name = ref.name;
      }
    }

    // Upsert lead (event_id+phone unique)
    const { data: existing } = await supabase
      .from('event_leads')
      .select('id, referral_token, referred_count, prize_unlocked_at, custom_fields')
      .eq('event_id', event_id)
      .eq('phone', e164)
      .maybeSingle();

    let lead: any;
    if (existing) {
      lead = existing;
      // Merge custom_fields do lead existente com os novos (novos sobrescrevem)
      if (Object.keys(cf).length > 0) {
        const merged = { ...(existing.custom_fields || {}), ...cf };
        await supabase
          .from('event_leads')
          .update({ custom_fields: merged })
          .eq('id', existing.id);
      }
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('event_leads')
        .insert({
          event_id,
          name: cleanName,
          phone: e164,
          source,
          instagram: instagram || null,
          landing_page_id: landing_page_id || null,
          typebot_id: typebot_id || null,
          referred_by_lead_id,
          utm_source: utm_source || null,
          utm_medium: utm_medium || null,
          utm_campaign: utm_campaign || null,
          metadata: metadata || {},
          custom_fields: cf,
          disqualified: isDisq,
        } as any)
        .select('id, referral_token, referred_count, prize_unlocked_at')
        .single();
      if (insErr) {
        console.error('Insert error:', insErr);
        return new Response(JSON.stringify({ error: insErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      lead = inserted;
    }

    // Fetch source config (vip group link etc.)
    let vip_group_link: string | null = null;
    let success_message: string | null = null;
    let event_starts_at: string | null = null;
    let prize_description: string | null = null;
    let public_slug = slug || null;

    if (source === 'lp' && landing_page_id) {
      const { data: lp } = await supabase
        .from('event_landing_pages')
        .select('vip_group_link, success_message, event_starts_at, prize_description, slug')
        .eq('id', landing_page_id)
        .maybeSingle();
      if (lp) {
        vip_group_link = lp.vip_group_link;
        success_message = lp.success_message;
        event_starts_at = lp.event_starts_at;
        prize_description = lp.prize_description;
        public_slug = lp.slug;
      }
    } else if (source === 'typebot' && typebot_id) {
      const { data: tb } = await supabase
        .from('event_typebots')
        .select('vip_group_link, success_message, event_starts_at, prize_description, slug')
        .eq('id', typebot_id)
        .maybeSingle();
      if (tb) {
        vip_group_link = tb.vip_group_link;
        success_message = tb.success_message;
        event_starts_at = tb.event_starts_at;
        prize_description = tb.prize_description;
        public_slug = tb.slug;
      }
    }

    const base = 'https://checkout.bananacalcados.com.br';
    const referral_link = public_slug
      ? `${base}/${source === 'typebot' ? 'typebot' : 'live'}/${public_slug}?ref=${lead.referral_token}`
      : null;

    // Resolve VIP group redirect (/vip/{slug}) into the actual chat.whatsapp.com invite,
    // so the client can jump straight to WhatsApp without any intermediate page.
    if (vip_group_link) {
      const vipMatch = vip_group_link.match(/\/vip\/([^/?#]+)/i);
      if (vipMatch) {
        let resolvedInvite: string | null = null;
        try {
          const resp = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/group-redirect-link?slug=${encodeURIComponent(vipMatch[1])}&mode=api`,
            { headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` } }
          );
          if (resp.ok) {
            const j = await resp.json();
            if (j?.invite_url) resolvedInvite = j.invite_url;
          }
        } catch (e) {
          console.error('vip resolve error:', e);
        }
        vip_group_link = resolvedInvite;
      }
    }

    // Trigger event-based automations (event_lead_captured / event_referral_milestone_3)
    try {
      const triggerTypes = ['event_lead_captured'];
      if (!existing && lead.prize_unlocked_at) triggerTypes.push('event_referral_milestone_3');

      const { data: flows } = await supabase
        .from('automation_flows')
        .select('id, name, trigger_config')
        .in('trigger_type', triggerTypes)
        .eq('is_active', true);

      const matched = (flows || []).filter((f: any) => {
        const cfg = f.trigger_config || {};
        if (cfg.event_id && cfg.event_id !== event_id) return false;
        if (cfg.source && cfg.source !== source) return false;
        if (cfg.landing_page_id && cfg.landing_page_id !== landing_page_id) return false;
        if (cfg.typebot_id && cfg.typebot_id !== typebot_id) return false;
        return true;
      });

      if (matched.length > 0) {
        // Enqueue a dispatch via automation-dispatch-audience-style endpoint.
        // For now we call automation-trigger-new-lead with a synthetic tag carrying context.
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/automation-trigger-new-lead`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            phone: e164,
            name: cleanName,
            campaignTag: `event_lead:${event_id}`,
            flowIds: matched.map((f: any) => f.id),
            metadata: {
              event_id,
              source,
              landing_page_id,
              typebot_id,
              referral_token: lead.referral_token,
              referral_link,
              referred_count: lead.referred_count,
              prize_unlocked: !!lead.prize_unlocked_at,
              vip_group_link,
              event_starts_at,
              referrer_name,
            },
          }),
        }).catch((e) => console.error('automation dispatch error:', e));
      }
    } catch (e) {
      console.error('automation trigger error:', e);
    }

    return new Response(JSON.stringify({
      success: true,
      already_registered: !!existing,
      lead_id: lead.id,
      referral_token: lead.referral_token,
      referral_link,
      referred_count: lead.referred_count,
      prize_unlocked: !!lead.prize_unlocked_at,
      vip_group_link,
      success_message,
      event_starts_at,
      prize_description,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('event-lead-capture error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
