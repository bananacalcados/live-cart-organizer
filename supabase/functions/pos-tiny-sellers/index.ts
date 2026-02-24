import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const TINY_V3_BASE = 'https://api.tiny.com.br/public-api/v3';

type ParsedSeller = {
  tiny_id: string;
  name: string;
  situacao: string;
};

const normalizeText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const isExplicitInactive = (status: unknown) => {
  if (status === false || status === 0) return true;
  const normalized = normalizeText(status);
  return [
    'i',
    'inativo',
    'inativa',
    'inactive',
    '0',
    'false',
    'n',
    'nao',
    'desativado',
    'desativada',
  ].includes(normalized);
};

const parseTinyV2Seller = (item: any): ParsedSeller | null => {
  const v = item?.vendedor || item || {};
  const tinyId = String(v.id ?? v.id_vendedor ?? v.idVendedor ?? v.codigo ?? '').trim();
  const name = String(v.nome ?? v.nome_contato ?? v.descricao ?? '').trim();
  const situacao = v.situacao ?? v.status ?? v.ativo ?? '';

  if (!tinyId || !name) return null;
  if (isExplicitInactive(situacao)) return null;

  return {
    tiny_id: tinyId,
    name,
    situacao: String(situacao ?? ''),
  };
};

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

    const [{ data: store }, { data: existingSellers }] = await Promise.all([
      supabase
        .from('pos_stores')
        .select('tiny_token')
        .eq('id', store_id)
        .single(),
      supabase
        .from('pos_sellers')
        .select('id, tiny_seller_id, name, is_active, updated_at')
        .eq('store_id', store_id)
        .order('updated_at', { ascending: false }),
    ]);

    let sellers: ParsedSeller[] = [];

    if (store?.tiny_token) {
      console.log('Using Tiny API v2 for sellers (per-store token)...');
      const resp = await fetch('https://api.tiny.com.br/api2/vendedores.pesquisa.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${store.tiny_token}&formato=json&pesquisa=`,
      });

      const rawResponse = await resp.text();
      let data: any = {};
      try {
        data = JSON.parse(rawResponse);
      } catch {
        throw new Error(`Tiny v2 respondeu formato inválido: ${rawResponse.slice(0, 250)}`);
      }

      if (!resp.ok) {
        throw new Error(`Tiny v2 error (${resp.status}): ${rawResponse.slice(0, 250)}`);
      }

      const rawSellers = Array.isArray(data?.retorno?.vendedores) ? data.retorno.vendedores : [];
      sellers = rawSellers
        .map(parseTinyV2Seller)
        .filter((seller): seller is ParsedSeller => !!seller);

      console.log(`[v2] Found ${sellers.length} active sellers (${rawSellers.length} total)`);
    }

    // Fallback to v3 global token only if no per-store token
    if (sellers.length === 0 && !store?.tiny_token) {
      const v3Token = await getTinyV3Token(supabase);
      if (v3Token) {
        try {
          console.log('Using Tiny API v3 for sellers (global fallback)...');
          const data = await tinyV3Get(v3Token, '/vendedores');
          const items = data.itens || data.items || [];
          sellers = (Array.isArray(items) ? items : []).map((v: any) => ({
            tiny_id: String(v.id || ''),
            name: v.contato?.nome || v.descricao || v.nome || v.name || '',
            situacao: String(v.situacao || 'A'),
          })).filter((s: ParsedSeller) => s.tiny_id && s.name && !isExplicitInactive(s.situacao));
          console.log(`[v3] Found ${sellers.length} active sellers`);
        } catch (e) {
          console.warn('Tiny v3 sellers failed:', (e as Error).message);
        }
      }
    }

    const existingRows = existingSellers || [];
    const existingByTinyId = new Map<string, any>();
    for (const row of existingRows) {
      const key = String(row.tiny_seller_id || '').trim();
      if (key && !existingByTinyId.has(key)) {
        existingByTinyId.set(key, row);
      }
    }

    let usedCachedFallback = false;

    if (sellers.length > 0) {
      await supabase
        .from('pos_sellers')
        .update({ is_active: false })
        .eq('store_id', store_id);

      for (const seller of sellers) {
        const existing = existingByTinyId.get(seller.tiny_id);

        if (existing) {
          await supabase
            .from('pos_sellers')
            .update({ name: seller.name, tiny_seller_id: seller.tiny_id, is_active: true })
            .eq('id', existing.id);
        } else {
          await supabase.from('pos_sellers').insert({
            store_id,
            name: seller.name,
            tiny_seller_id: seller.tiny_id,
            is_active: true,
          });
        }
      }

      console.log(`Synced ${sellers.length} active sellers for store ${store_id}`);
    } else if (existingRows.length > 0) {
      const seen = new Set<string>();
      const fallbackIds: string[] = [];

      for (const row of existingRows) {
        const key = String(row.tiny_seller_id || '').trim() || normalizeText(row.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        fallbackIds.push(row.id);
      }

      await supabase
        .from('pos_sellers')
        .update({ is_active: false })
        .eq('store_id', store_id);

      if (fallbackIds.length > 0) {
        await supabase
          .from('pos_sellers')
          .update({ is_active: true })
          .in('id', fallbackIds);
      }

      usedCachedFallback = fallbackIds.length > 0;
      console.warn(`Tiny returned 0 active sellers for store ${store_id}. Kept ${fallbackIds.length} cached sellers active.`);
    }

    const { data: dbSellers } = await supabase
      .from('pos_sellers')
      .select('*')
      .eq('store_id', store_id)
      .eq('is_active', true)
      .order('name');

    return new Response(JSON.stringify({
      success: true,
      sellers: dbSellers || [],
      fallback_used: usedCachedFallback,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message, sellers: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
