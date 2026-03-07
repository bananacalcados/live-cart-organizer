// VIP Group redirect — optimized v3 (cache-first, 302 redirects, non-blocking analytics)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const slug = url.searchParams.get('slug') || '';
    const mode = url.searchParams.get('mode');
    const isApiMode = mode === 'api';

    if (!slug) {
      return new Response(
        JSON.stringify({ error: 'slug is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Single query: fetch link with cached URL
    const { data: link, error: linkErr } = await supabase
      .from('group_redirect_links')
      .select('id, slug, campaign_id, click_count, redirect_count, is_active, is_deep_link, cached_invite_url, cached_at, group_campaigns!inner(target_groups, is_deep_link)')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (linkErr || !link) {
      if (isApiMode) {
        return new Response(
          JSON.stringify({ invite_url: null, error: 'link_not_found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Link não encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    // Fire-and-forget: increment click count (non-blocking)
    supabase.from('group_redirect_links')
      .update({ click_count: (link.click_count || 0) + 1 })
      .eq('id', link.id)
      .then(() => {});

    // ─── FAST PATH: cached URL ───
    let redirectUrl: string | null = null;
    const cachedAt = link.cached_at ? new Date(link.cached_at).getTime() : 0;
    const isCacheFresh = link.cached_invite_url && (Date.now() - cachedAt < CACHE_TTL_MS);

    if (isCacheFresh) {
      redirectUrl = link.cached_invite_url;
      console.log(`[FAST] Cache hit for slug="${slug}"`);
    }

    // ─── SLOW PATH: resolve group ───
    if (!redirectUrl) {
      console.log(`[SLOW] Cache miss for slug="${slug}", resolving...`);
      redirectUrl = await resolveGroupUrl(supabase, link, supabaseUrl, supabaseKey);

      // Cache the result for next time (non-blocking)
      if (redirectUrl) {
        supabase.from('group_redirect_links')
          .update({ cached_invite_url: redirectUrl, cached_at: new Date().toISOString() })
          .eq('id', link.id)
          .then(() => {});
      }
    }

    // ─── NO GROUP AVAILABLE ───
    if (!redirectUrl) {
      if (isApiMode) {
        return new Response(
          JSON.stringify({ invite_url: null, error: 'no_group_available' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Return minimal auto-retry HTML
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preparando...</title>
        <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#075e54;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}.c{text-align:center;padding:2rem}.s{border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;width:40px;height:40px;animation:r .8s linear infinite;margin:0 auto 1rem}@keyframes r{to{transform:rotate(360deg)}}.b{background:#25D366;color:#fff;border:none;padding:.75rem 1.5rem;border-radius:50px;font-weight:600;cursor:pointer;font-size:.95rem}</style>
        </head><body><div class="c"><div class="s"></div><h2>⏳ Preparando grupo VIP</h2><p style="opacity:.85;margin:.5rem 0 1rem;font-size:.9rem">Redirecionando em <span id="t">5</span>s...</p><button class="b" onclick="location.reload()">Tentar agora</button></div>
        <script>let n=5;const e=document.getElementById('t');setInterval(()=>{if(--n<=0)location.reload();e.textContent=n},1000)</script></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    // Fire-and-forget: increment redirect count (non-blocking)
    supabase.from('group_redirect_links')
      .update({ redirect_count: (link.redirect_count || 0) + 1 })
      .eq('id', link.id)
      .then(() => {});

    // ─── API MODE: return JSON ───
    if (isApiMode) {
      return new Response(
        JSON.stringify({ invite_url: redirectUrl }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── DETECT IN-APP BROWSER ───
    const userAgent = req.headers.get('user-agent') || '';
    const isInApp = /Instagram|FBAN|FBAV/i.test(userAgent);

    if (isInApp) {
      // In-app browsers can't open WhatsApp directly, show instructions
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Abrir no navegador</title>
        <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#075e54;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}.c{background:rgba(0,0,0,.25);border-radius:16px;padding:2rem;text-align:center;max-width:360px;width:100%}.w{background:rgba(255,180,0,.15);border:1px solid rgba(255,180,0,.4);border-radius:10px;padding:1rem;margin-bottom:1rem;text-align:left}ol{padding-left:1.2rem;margin-top:.5rem}li{font-size:.85rem;margin-bottom:.35rem}.b{display:block;width:100%;background:#25D366;color:#fff;border:none;padding:.75rem;border-radius:50px;font-weight:600;cursor:pointer;font-size:.95rem;margin-bottom:.5rem;text-decoration:none;text-align:center}</style>
        </head><body><div class="c"><div class="w"><strong>📱 Abra no navegador</strong><ol><li>Toque nos <strong>3 pontos</strong> (⋮) acima</li><li>Selecione <strong>"Abrir no navegador"</strong></li><li>Ou copie o link abaixo</li></ol></div><button class="b" onclick="navigator.clipboard&&navigator.clipboard.writeText('${redirectUrl}').then(()=>alert('Link copiado!'))">📋 Copiar link do grupo</button><a href="${redirectUrl}" class="b" style="background:rgba(255,255,255,.15)">Tentar assim mesmo</a></div></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    // ─── INSTANT 302 REDIRECT ───
    const campaign = link.group_campaigns as any;
    const useDeepLink = link.is_deep_link || campaign?.is_deep_link;
    const isAndroid = /android/i.test(userAgent);

    let finalUrl = redirectUrl;
    if (useDeepLink && isAndroid) {
      const inviteCode = redirectUrl.replace('https://chat.whatsapp.com/', '');
      finalUrl = `intent://invite/${inviteCode}#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=${encodeURIComponent(redirectUrl)};end`;
    }

    return new Response(null, {
      status: 302,
      headers: { 'Location': finalUrl, 'Cache-Control': 'no-cache, no-store' },
    });

  } catch (error) {
    console.error('Error in redirect:', error);
    return new Response('Erro temporário. Tente novamente.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
});

// ─── Helper: resolve the WhatsApp invite URL from campaign groups ───
async function resolveGroupUrl(
  supabase: any,
  link: any,
  supabaseUrl: string,
  supabaseKey: string
): Promise<string | null> {
  const campaign = link.group_campaigns as any;
  const targetGroupIds = campaign?.target_groups || [];

  if (!targetGroupIds.length) return null;

  const { data: groups } = await supabase
    .from('whatsapp_groups')
    .select('id, group_id, name, invite_link, is_full, participant_count, max_participants')
    .in('id', targetGroupIds)
    .eq('is_full', false)
    .order('participant_count', { ascending: false });

  if (!groups || groups.length === 0) {
    return await tryAutoCreate(supabaseUrl, supabaseKey, link.campaign_id);
  }

  // Try groups with existing invite links first
  for (const group of groups) {
    if (group.invite_link) return group.invite_link;
  }

  // Generate invite link for first available group
  const group = groups[0];
  const inviteLink = await fetchInviteLink(group.group_id);
  if (inviteLink) {
    // Save for future use (non-blocking)
    supabase.from('whatsapp_groups')
      .update({ invite_link: inviteLink })
      .eq('id', group.id)
      .then(() => {});
    return inviteLink;
  }

  return await tryAutoCreate(supabaseUrl, supabaseKey, link.campaign_id);
}

async function fetchInviteLink(groupId: string): Promise<string | null> {
  const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
  const token = Deno.env.get('ZAPI_TOKEN');
  const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');
  if (!instanceId || !token || !clientToken) return null;

  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/group-invitation-link/${groupId}`,
      { method: 'GET', headers: { 'Client-Token': clientToken } }
    );
    const data = await res.json();
    return data.invitationLink || data.link || null;
  } catch {
    return null;
  }
}

async function tryAutoCreate(supabaseUrl: string, supabaseKey: string, campaignId: string): Promise<string | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/auto-create-vip-group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
      body: JSON.stringify({ campaign_id: campaignId }),
    });
    const result = await res.json();
    return result.success && result.group?.invite_link ? result.group.invite_link : null;
  } catch {
    return null;
  }
}
