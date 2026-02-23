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
  const connectedAt = new Date(tokenData.connected_at || tokenData.refreshed_at || 0).getTime();
  const expiresIn = (tokenData.expires_in || 300) * 1000;
  const now = Date.now();

  if (now - connectedAt > expiresIn - 30000) {
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

    let methods: Array<{ id: string; name: string }> = [];

    // Try API v3 first
    const v3Token = await getTinyV3Token(supabase);
    if (v3Token) {
      try {
        console.log('Using Tiny API v3 for payment methods...');
        const resp = await fetch(`${TINY_V3_BASE}/formas-recebimento`, {
          headers: { 'Authorization': `Bearer ${v3Token}`, 'Accept': 'application/json' },
        });
        if (resp.ok) {
          const data = await resp.json();
          const items = data.itens || data.items || data || [];
          methods = (Array.isArray(items) ? items : []).map((m: any) => ({
            id: String(m.id || ''),
            name: m.descricao || m.nome || m.name || 'Sem nome',
          })).filter((m: any) => m.id);
          console.log(`[v3] Found ${methods.length} payment methods`);
        } else {
          console.warn('Tiny v3 payment methods failed:', resp.status, await resp.text().catch(() => ''));
        }
      } catch (e) {
        console.warn('Tiny v3 payment methods error:', e.message);
      }
    }

    // Fallback to API v2
    if (methods.length === 0) {
      const { data: store } = await supabase
        .from('pos_stores')
        .select('tiny_token')
        .eq('id', store_id)
        .single();

      if (store?.tiny_token) {
        console.log('Using Tiny API v2 for payment methods (fallback)...');
        const resp = await fetch('https://api.tiny.com.br/api2/formas.recebimento.pesquisa.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${store.tiny_token}&formato=json`,
        });
        const data = await resp.json();
        const rawMethods = data.retorno?.formas_recebimento || data.retorno?.formasPagamento || data.retorno?.formasRecebimento || [];
        methods = rawMethods.map((item: any) => {
          const inner = item.forma_recebimento || item.formaRecebimento || item.formaPagamento || item;
          const name = inner.descricao || inner.nome || item.descricao || item.nome || 'Sem nome';
          const id = String(inner.id || item.id || name.toLowerCase().replace(/\s+/g, '_'));
          return { id, name };
        });
        console.log(`[v2] Found ${methods.length} payment methods`);
      }
    }

    // Cache in DB
    if (methods.length > 0) {
      for (const m of methods) {
        await supabase.from('pos_payment_methods').upsert(
          { id: m.id, store_id, name: m.name, is_active: true },
          { onConflict: 'store_id,id' }
        );
      }
    }

    // If still empty, load from DB cache
    if (methods.length === 0) {
      const { data: cached } = await supabase
        .from('pos_payment_methods')
        .select('id, name')
        .eq('store_id', store_id)
        .eq('is_active', true)
        .order('sort_order');
      if (cached && cached.length > 0) {
        console.log(`No API data, using ${cached.length} cached payment methods`);
        return new Response(JSON.stringify({ success: true, methods: cached, source: 'cache' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ success: true, methods }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // On any error, try DB fallback
    try {
      const { store_id } = await req.clone().json().catch(() => ({ store_id: null }));
      if (store_id) {
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: cached } = await supabase
          .from('pos_payment_methods')
          .select('id, name')
          .eq('store_id', store_id)
          .eq('is_active', true)
          .order('sort_order');
        if (cached && cached.length > 0) {
          return new Response(JSON.stringify({ success: true, methods: cached, source: 'cache' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    } catch {}
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message, methods: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
