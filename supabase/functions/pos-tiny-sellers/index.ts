import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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
  return ['i', 'inativo', 'inativa', 'inactive', '0', 'false', 'n', 'nao', 'desativado', 'desativada'].includes(normalized);
};

type ParsedSeller = { tiny_id: string; name: string };

const parseTinyV2Seller = (item: any): ParsedSeller | null => {
  const v = item?.vendedor || item || {};
  const tinyId = String(v.id ?? v.id_vendedor ?? v.idVendedor ?? v.codigo ?? '').trim();
  const name = String(v.nome ?? v.nome_contato ?? v.descricao ?? '').trim();
  const situacao = v.situacao ?? v.status ?? v.ativo ?? '';
  if (!tinyId || !name) return null;
  if (isExplicitInactive(situacao)) return null;
  return { tiny_id: tinyId, name };
};

async function fetchTinyV2Sellers(tinyToken: string): Promise<ParsedSeller[]> {
  const resp = await fetch('https://api.tiny.com.br/api2/vendedores.pesquisa.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${tinyToken}&formato=json&pesquisa=`,
  });
  const rawText = await resp.text();
  let data: any;
  try { data = JSON.parse(rawText); } catch { return []; }
  const rawSellers = Array.isArray(data?.retorno?.vendedores) ? data.retorno.vendedores : [];
  return rawSellers.map(parseTinyV2Seller).filter((s): s is ParsedSeller => !!s);
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

    // Fetch store token and existing sellers in parallel
    const [{ data: store }, { data: existingSellers }] = await Promise.all([
      supabase.from('pos_stores').select('tiny_token').eq('id', store_id).single(),
      supabase.from('pos_sellers').select('id, tiny_seller_id, name, is_active').eq('store_id', store_id),
    ]);

    if (!store?.tiny_token) {
      // No token — just return existing active sellers
      const active = (existingSellers || []).filter(s => s.is_active);
      return new Response(JSON.stringify({ success: true, sellers: active, fallback_used: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch sellers from Tiny using this store's own token
    const tinySellers = await fetchTinyV2Sellers(store.tiny_token);
    console.log(`[v2] Store ${store_id}: ${tinySellers.length} active sellers from Tiny`);

    const existingRows = existingSellers || [];
    const existingByTinyId = new Map<string, typeof existingRows[0]>();
    for (const row of existingRows) {
      const key = String(row.tiny_seller_id || '').trim();
      if (key) {
        // Keep the first one found (map won't overwrite)
        if (!existingByTinyId.has(key)) existingByTinyId.set(key, row);
      }
    }

    if (tinySellers.length > 0) {
      const tinyIdSet = new Set(tinySellers.map(s => s.tiny_id));

      // UPSERT: update existing or insert new
      for (const seller of tinySellers) {
        const existing = existingByTinyId.get(seller.tiny_id);
        if (existing) {
          // Update name and activate
          await supabase.from('pos_sellers')
            .update({ name: seller.name, is_active: true })
            .eq('id', existing.id);
        } else {
          // Insert new (constraint prevents duplicates)
          await supabase.from('pos_sellers').insert({
            store_id, name: seller.name, tiny_seller_id: seller.tiny_id, is_active: true,
          });
        }
      }

      // Deactivate sellers NOT in Tiny response (only those with tiny_seller_id)
      const toDeactivate = existingRows.filter(r => {
        const key = String(r.tiny_seller_id || '').trim();
        return key && !tinyIdSet.has(key);
      });
      if (toDeactivate.length > 0) {
        await supabase.from('pos_sellers')
          .update({ is_active: false })
          .in('id', toDeactivate.map(r => r.id));
      }

      console.log(`Synced ${tinySellers.length} sellers, deactivated ${toDeactivate.length}`);
    } else {
      // Tiny returned 0 — keep existing active as fallback
      console.warn(`Tiny returned 0 sellers for store ${store_id}. Keeping existing.`);
    }

    // Return only active sellers
    const { data: dbSellers } = await supabase
      .from('pos_sellers')
      .select('*')
      .eq('store_id', store_id)
      .eq('is_active', true)
      .order('name');

    return new Response(JSON.stringify({
      success: true,
      sellers: dbSellers || [],
      fallback_used: tinySellers.length === 0,
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
