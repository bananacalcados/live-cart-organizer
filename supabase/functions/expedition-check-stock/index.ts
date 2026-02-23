import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Fetch real-time stock from Tiny ERP for a list of SKUs/barcodes across all stores.
 * Updates the local pos_products cache and returns fresh stock data.
 * Accepts max ~15 items per call to respect rate limits.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { skus } = await req.json();
    if (!skus || !Array.isArray(skus) || skus.length === 0) {
      throw new Error('skus array is required');
    }

    const limitedSkus = skus.slice(0, 15);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Find all pos_products entries matching these SKUs (by sku or barcode)
    const [{ data: bySku }, { data: byBarcode }] = await Promise.all([
      supabase
        .from('pos_products')
        .select('id, sku, barcode, stock, store_id, tiny_id, pos_stores:store_id(id, name, tiny_token, tiny_deposit_name)')
        .in('sku', limitedSkus),
      supabase
        .from('pos_products')
        .select('id, sku, barcode, stock, store_id, tiny_id, pos_stores:store_id(id, name, tiny_token, tiny_deposit_name)')
        .in('barcode', limitedSkus),
    ]);

    // Deduplicate by pos_products.id
    const allProducts = new Map<string, any>();
    [...(bySku || []), ...(byBarcode || [])].forEach(p => {
      allProducts.set(p.id, p);
    });

    const results: Record<string, Array<{ storeName: string; depositName: string; storeId: string; stock: number; reserved: number }>> = {};
    const updates: Array<{ id: string; stock: number }> = [];

    // Group by tiny_id + store to avoid duplicate API calls
    const seen = new Set<string>();

    for (const p of allProducts.values()) {
      if (!p.tiny_id || !p.pos_stores?.tiny_token) continue;

      const callKey = `${p.tiny_id}-${p.store_id}`;
      if (seen.has(callKey)) continue;
      seen.add(callKey);

      try {
        const resp = await fetch('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${p.pos_stores.tiny_token}&formato=json&id=${p.tiny_id}`,
        });
        const data = await resp.json();

        if (data.retorno?.status !== 'Erro') {
          const produto = data.retorno?.produto;
          const depositos = produto?.depositos || [];
          let stock = parseFloat(produto?.saldo || '0');
          let reserved = parseFloat(produto?.saldoReservado || '0');
          const depositName = p.pos_stores.tiny_deposit_name;

          // Filter by deposit if configured
          if (depositName && depositos.length > 0) {
            const matched = depositos.find((d: any) => {
              const dep = d?.deposito || d;
              const name = dep?.nome || dep?.descricao || '';
              return name.toLowerCase() === depositName.toLowerCase();
            });
            if (matched) {
              const dep = matched?.deposito || matched;
              stock = parseFloat(dep?.saldo || '0');
              reserved = parseFloat(dep?.saldoReservado || '0');
            }
          }

          // Determine the lookup key (whichever SKU the expedition uses)
          const matchKey = limitedSkus.find(s => s === p.sku || s === p.barcode) || p.sku;
          if (!results[matchKey]) results[matchKey] = [];
          
          // Avoid duplicate store entries
          if (!results[matchKey].some(r => r.storeId === p.store_id)) {
            results[matchKey].push({
              storeName: p.pos_stores.name,
              depositName: depositName || '',
              storeId: p.store_id,
              stock,
              reserved,
            });
          }

          // Queue cache update
          updates.push({ id: p.id, stock });

          console.log(`[expedition-check-stock] ${p.sku} @ ${depositName}: stock=${stock}, reserved=${reserved}`);
        }
      } catch (e) {
        console.error(`Error fetching stock for tiny_id ${p.tiny_id}:`, e);
      }

      // Throttle: 2s between calls
      await new Promise(r => setTimeout(r, 1500));
    }

    // Batch update cache
    for (const u of updates) {
      await supabase
        .from('pos_products')
        .update({ stock: u.stock, synced_at: new Date().toISOString() })
        .eq('id', u.id);
    }

    return new Response(JSON.stringify({ success: true, stock: results }), {
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
