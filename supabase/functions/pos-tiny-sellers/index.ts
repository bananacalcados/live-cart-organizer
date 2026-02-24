import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const TINY_V3_BASE = 'https://api.tiny.com.br/public-api/v3';

async function getTinyV3Token(supabase: any): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'tiny_app_token')
    .single();

  if (!data?.value?.access_token) return null;

  const tokenData = data.value as any;

  // Check if token needs refresh (expires_in is typically 300s = 5min)
  const connectedAt = new Date(tokenData.connected_at || tokenData.refreshed_at || 0).getTime();
  const expiresIn = (tokenData.expires_in || 300) * 1000;
  const now = Date.now();

  if (now - connectedAt > expiresIn - 30000) {
    // Token expired or about to expire, refresh it
    console.log('Tiny v3 token expired, refreshing...');
    try {
      const refreshRes = await fetch('https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
          client_id: Deno.env.get('TINY_APP_CLIENT_ID')!,
          client_secret: Deno.env.get('TINY_APP_CLIENT_SECRET')!,
        }).toString(),
      });

      if (!refreshRes.ok) {
        console.error('Token refresh failed:', await refreshRes.text());
        return null;
      }

      const newTokens = await refreshRes.json();
      await supabase.from('app_settings').upsert({
        key: 'tiny_app_token',
        value: {
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token || tokenData.refresh_token,
          id_token: newTokens.id_token,
          expires_in: newTokens.expires_in,
          token_type: newTokens.token_type,
          refreshed_at: new Date().toISOString(),
          connected_at: tokenData.connected_at,
        },
      }, { onConflict: 'key' });

      console.log('Tiny v3 token refreshed successfully');
      return newTokens.access_token;
    } catch (e) {
      console.error('Token refresh error:', e);
      return null;
    }
  }

  return tokenData.access_token;
}

async function tinyV3Get(token: string, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${TINY_V3_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Tiny v3 ${path} failed (${resp.status}): ${errText.substring(0, 300)}`);
  }
  return resp.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id } = await req.json();
    if (!store_id) throw new Error('store_id is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Try API v3 first
    const v3Token = await getTinyV3Token(supabase);
    let sellers: Array<{ tiny_id: string; name: string }> = [];

    if (v3Token) {
      try {
        console.log('Using Tiny API v3 for sellers...');
        const data = await tinyV3Get(v3Token, '/vendedores');
        const items = data.itens || data.items || [];
        
        sellers = (Array.isArray(items) ? items : []).map((v: any) => ({
          tiny_id: String(v.id || ''),
          name: v.contato?.nome || v.descricao || v.nome || v.name || '',
          situacao: v.situacao || 'A',
        })).filter((s: any) => s.tiny_id && s.name && s.situacao === 'A');
        
        console.log(`[v3] Found ${sellers.length} active sellers`);
      } catch (e) {
        console.warn('Tiny v3 sellers failed, falling back to v2:', e.message);
      }
    }

    // Fallback to API v2 if v3 failed or unavailable
    if (sellers.length === 0) {
      const { data: store } = await supabase
        .from('pos_stores')
        .select('tiny_token')
        .eq('id', store_id)
        .single();

      if (store?.tiny_token) {
        console.log('Using Tiny API v2 for sellers (fallback)...');
        const resp = await fetch('https://api.tiny.com.br/api2/vendedores.pesquisa.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${store.tiny_token}&formato=json&pesquisa=`,
        });
        const data = await resp.json();
        const rawSellers = data.retorno?.vendedores || [];
        sellers = rawSellers.map((item: any) => {
          const v = item.vendedor || item;
          return { tiny_id: String(v.id || ''), name: v.nome || 'Sem nome' };
        }).filter((s: any) => {
          const situacao = (s as any).situacao || 'A';
          return situacao === 'A' || situacao === 'Ativo';
        });
        console.log(`[v2] Found ${sellers.length} active sellers`);
      }
    }

    // Sync sellers to pos_sellers table
    for (const seller of sellers) {
      const { data: existing } = await supabase
        .from('pos_sellers')
        .select('id')
        .eq('store_id', store_id)
        .eq('tiny_seller_id', seller.tiny_id)
        .maybeSingle();

      if (!existing) {
        await supabase.from('pos_sellers').insert({
          store_id,
          name: seller.name,
          tiny_seller_id: seller.tiny_id,
          is_active: true,
        });
      }
    }

    // Return updated sellers from DB
    const { data: dbSellers } = await supabase
      .from('pos_sellers')
      .select('*')
      .eq('store_id', store_id)
      .eq('is_active', true)
      .order('name');

    return new Response(JSON.stringify({ success: true, sellers: dbSellers || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message, sellers: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
