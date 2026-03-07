// VIP Group redirect with API mode support - v2
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

    // Fetch redirect link
    const { data: link, error: linkErr } = await supabase
      .from('group_redirect_links')
      .select('*, group_campaigns!inner(target_groups, is_deep_link)')
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
      return new Response('<html><body><h1>Link não encontrado</h1></body></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Increment click count
    await supabase.from('group_redirect_links')
      .update({ click_count: (link.click_count || 0) + 1 })
      .eq('id', link.id);

    const campaign = link.group_campaigns;
    const targetGroupIds = campaign.target_groups || [];

    // Get ALL non-full groups (don't filter by invite_link)
    const { data: groups } = await supabase
      .from('whatsapp_groups')
      .select('id, group_id, name, invite_link, is_full, participant_count, max_participants')
      .in('id', targetGroupIds)
      .eq('is_full', false)
      .order('participant_count', { ascending: false });

    // Helper to fetch invite link from Z-API
    const fetchInviteLink = async (groupId: string): Promise<string | null> => {
      const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
      const token = Deno.env.get('ZAPI_TOKEN');
      const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');
      if (!instanceId || !token || !clientToken) {
        console.error('Z-API credentials missing');
        return null;
      }

      try {
        // Z-API docs: POST group-invitation-link/{groupId} - groupId includes "-group" suffix
        const apiUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}/group-invitation-link/${groupId}`;
        console.log(`Fetching invite link from: ${apiUrl}`);
        const res = await fetch(apiUrl, {
          method: 'GET',
          headers: { 'Client-Token': clientToken },
        });
        const data = await res.json();
        console.log('Z-API invite link response:', JSON.stringify(data));
        return data.invitationLink || data.link || null;
      } catch (e) {
        console.error('Error fetching invite link:', e);
        return null;
      }
    };

    let targetGroup = null;
    let redirectUrl: string | null = null;

    if (groups && groups.length > 0) {
      // Try to find a group with an invite link, or generate one
      for (const group of groups) {
        if (group.invite_link) {
          targetGroup = group;
          redirectUrl = group.invite_link;
          break;
        }
      }

      // If no group has an invite link, generate one for the first available group
      if (!redirectUrl && groups.length > 0) {
        const group = groups[0];
        console.log(`Group "${group.name}" has no invite link, fetching from Z-API...`);
        const inviteLink = await fetchInviteLink(group.group_id);
        if (inviteLink) {
          // Save the invite link for future use
          await supabase.from('whatsapp_groups')
            .update({ invite_link: inviteLink })
            .eq('id', group.id);
          targetGroup = group;
          redirectUrl = inviteLink;
          console.log(`Generated invite link for "${group.name}": ${inviteLink}`);
        }
      }
    }

    // If still no group available, try auto-creating
    if (!redirectUrl) {
      console.log('No available groups for campaign, attempting auto-create...');
      try {
        const autoCreateRes = await fetch(`${supabaseUrl}/functions/v1/auto-create-vip-group`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ campaign_id: link.campaign_id }),
        });
        const autoResult = await autoCreateRes.json();

        if (autoResult.success && autoResult.group?.invite_link) {
          console.log('Auto-created group:', autoResult.group.name);
          redirectUrl = autoResult.group.invite_link;
        } else {
          console.error('Auto-create response:', autoResult);
        }
      } catch (e) {
        console.error('Auto-create failed:', e);
      }
    }

    if (!redirectUrl && isApiMode) {
      return new Response(
        JSON.stringify({ invite_url: null, error: 'no_group_available' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!redirectUrl) {
      return new Response(
        `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preparando grupo...</title>
        <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#075e54;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}.card{background:rgba(0,0,0,.25);border-radius:16px;padding:2rem;text-align:center;max-width:360px;width:100%}.spinner{border:3px solid rgba(255,255,255,.3);border-top:3px solid white;border-radius:50%;width:44px;height:44px;animation:spin .9s linear infinite;margin:0 auto 1.2rem}@keyframes spin{to{transform:rotate(360deg)}}h2{font-size:1.15rem;margin-bottom:.5rem}p{font-size:.9rem;opacity:.85;margin-bottom:1rem;line-height:1.5}.btn{display:inline-block;background:#25D366;color:white;text-decoration:none;padding:.75rem 1.5rem;border-radius:50px;font-weight:600;font-size:.95rem;cursor:pointer;border:none;width:100%;max-width:260px}#cd{font-weight:bold}</style>
        </head><body><div class="card"><div class="spinner"></div><h2>⏳ Preparando seu grupo VIP</h2><p>Estamos configurando um grupo exclusivo. Redirecionando em <span id="cd">10</span>s...</p><button class="btn" onclick="location.reload()">Tentar agora</button></div>
        <script>let t=10;const c=document.getElementById('cd');const i=setInterval(()=>{t--;c.textContent=t;if(t<=0){clearInterval(i);location.reload();}},1000);</script>
        </body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Deep link format
    const useDeepLink = link.is_deep_link || campaign.is_deep_link;
    if (useDeepLink && redirectUrl) {
      const inviteCode = redirectUrl.replace('https://chat.whatsapp.com/', '');
      const userAgent = req.headers.get('user-agent') || '';
      const isAndroid = userAgent.toLowerCase().includes('android');
      
      if (isAndroid) {
        redirectUrl = `intent://invite/${inviteCode}#Intent;scheme=whatsapp;package=com.whatsapp;end`;
      } else {
        redirectUrl = `https://chat.whatsapp.com/${inviteCode}`;
      }
    }

    // Increment redirect count
    await supabase.from('group_redirect_links')
      .update({ redirect_count: (link.redirect_count || 0) + 1 })
      .eq('id', link.id);

    if (isApiMode) {
      return new Response(
        JSON.stringify({ invite_url: redirectUrl }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2;url=${redirectUrl}">
<title>Redirecionando...</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#075e54;color:white}.container{text-align:center}.spinner{border:3px solid rgba(255,255,255,0.3);border-top:3px solid white;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin:0 auto 16px}@keyframes spin{to{transform:rotate(360deg)}}a{color:white}</style>
</head><body><div class="container"><div class="spinner"></div><h2>Entrando no grupo...</h2><p>Você será redirecionado automaticamente.</p><p><a href="${redirectUrl}">Clique aqui se não for redirecionado</a></p></div>
<script>window.location.href="${redirectUrl}";</script></body></html>`;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error('Error in redirect:', error);
    return new Response(
      `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Erro</title>
      <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#075e54;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}.card{background:rgba(0,0,0,.25);border-radius:16px;padding:2rem;text-align:center;max-width:360px;width:100%}h2{font-size:1.1rem;margin-bottom:.75rem}p{font-size:.9rem;opacity:.85;margin-bottom:1.2rem;line-height:1.5}.btn{display:inline-block;background:#25D366;color:white;text-decoration:none;padding:.75rem 1.5rem;border-radius:50px;font-weight:600;font-size:.95rem;cursor:pointer;border:none;width:100%;max-width:260px}</style>
      </head><body><div class="card"><h2>⚠️ Erro temporário</h2><p>Não foi possível processar o link agora. Tente novamente em instantes.</p><button class="btn" onclick="location.reload()">Tentar novamente</button></div></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
});
