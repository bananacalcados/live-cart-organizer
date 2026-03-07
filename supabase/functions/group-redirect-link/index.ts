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
      .order('participant_count', { ascending: true });

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

    if (!redirectUrl) {
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Grupo</title>
        <style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#075e54;color:white;text-align:center}.container{padding:2rem}a{color:#25D366;text-decoration:underline}</style>
        </head><body><div class="container"><h2>⏳ Grupo sendo preparado</h2><p>O grupo está sendo configurado. Tente novamente em alguns instantes.</p><p><a href="${url.toString()}">Tentar novamente</a></p></div></body></html>`,
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
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
