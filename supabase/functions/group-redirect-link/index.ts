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

    // Get groups with invite links, ordered by fullness
    const { data: groups } = await supabase
      .from('whatsapp_groups')
      .select('id, group_id, name, invite_link, is_full, participant_count, max_participants')
      .in('id', targetGroupIds)
      .eq('is_full', false)
      .not('invite_link', 'is', null)
      .order('participant_count', { ascending: true });

    if (!groups || groups.length === 0) {
      return new Response('<html><body><h1>Todos os grupos estão cheios</h1><p>Tente novamente mais tarde.</p></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    const targetGroup = groups[0];
    let redirectUrl = targetGroup.invite_link;

    // Deep link format
    const useDeepLink = link.is_deep_link || campaign.is_deep_link;
    if (useDeepLink && redirectUrl) {
      // Extract invite code from URL like https://chat.whatsapp.com/CODE
      const inviteCode = redirectUrl.replace('https://chat.whatsapp.com/', '');
      // Use intent:// for Android deep link, fallback to regular URL
      const userAgent = req.headers.get('user-agent') || '';
      const isAndroid = userAgent.toLowerCase().includes('android');
      
      if (isAndroid) {
        redirectUrl = `intent://invite/${inviteCode}#Intent;scheme=whatsapp;package=com.whatsapp;end`;
      } else {
        // iOS and others use the regular whatsapp link which works better
        redirectUrl = `https://chat.whatsapp.com/${inviteCode}`;
      }
    }

    // Increment redirect count
    await supabase.from('group_redirect_links')
      .update({ redirect_count: (link.redirect_count || 0) + 1 })
      .eq('id', link.id);

    // HTML redirect page with meta refresh fallback
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="2;url=${redirectUrl}">
  <title>Redirecionando...</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #075e54; color: white; }
    .container { text-align: center; }
    .spinner { border: 3px solid rgba(255,255,255,0.3); border-top: 3px solid white; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    a { color: white; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h2>Entrando no grupo...</h2>
    <p>Você será redirecionado automaticamente.</p>
    <p><a href="${redirectUrl}">Clique aqui se não for redirecionado</a></p>
  </div>
  <script>window.location.href = "${redirectUrl}";</script>
</body>
</html>`;

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
