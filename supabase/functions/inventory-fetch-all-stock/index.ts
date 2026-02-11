import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Fetch all products from pos_products cache for a given store and enrich with Tiny stock data.
 * Uses the local cache to avoid expensive Tiny API calls for listing.
 * Optionally filters by category.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, count_id, categories, page = 0, page_size = 50 } = await req.json();
    if (!store_id || !count_id) throw new Error('store_id and count_id are required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get store token
    const { data: store } = await supabase
      .from('pos_stores')
      .select('tiny_token')
      .eq('id', store_id)
      .single();

    if (!store?.tiny_token) throw new Error('Store not found or token missing');

    // Get products from local cache
    let query = supabase
      .from('pos_products')
      .select('*', { count: 'exact' })
      .eq('store_id', store_id)
      .order('name', { ascending: true })
      .range(page * page_size, (page + 1) * page_size - 1);

    if (categories && categories.length > 0) {
      query = query.in('category', categories);
    }

    const { data: products, error: prodError, count } = await query;
    if (prodError) throw prodError;

    // For each product, get current stock from Tiny (throttled)
    const enriched = [];
    const startTime = Date.now();
    const MAX_RUNTIME = 30000; // 30s safety

    for (const p of products || []) {
      if (Date.now() - startTime > MAX_RUNTIME) break;

      let stock = 0;
      try {
        const resp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${store.tiny_token}&formato=json&id=${p.tiny_id}`,
        });
        const data = await resp.json();
        if (data.retorno?.status !== 'Erro') {
          stock = parseFloat(data.retorno?.produto?.saldo || '0');
        }
      } catch (e) {
        console.error(`Error getting stock for ${p.tiny_id}:`, e);
      }

      enriched.push({
        product_id: String(p.tiny_id),
        product_name: p.name + (p.variant ? ` - ${p.variant}` : ''),
        sku: p.sku || '',
        barcode: p.barcode || '',
        current_stock: stock,
        category: p.category || null,
      });

      // Throttle ~30 req/min
      await new Promise(r => setTimeout(r, 2000));
    }

    return new Response(JSON.stringify({
      success: true,
      products: enriched,
      total: count || 0,
      page,
      has_more: ((page + 1) * page_size) < (count || 0),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
