import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { store_id } = await req.json();

    // If store_id provided, sync just that store; otherwise sync all stores
    let stores: { id: string; tiny_token: string }[] = [];
    if (store_id) {
      const { data, error } = await supabase
        .from('pos_stores')
        .select('id, tiny_token')
        .eq('id', store_id)
        .single();
      if (error || !data?.tiny_token) throw new Error('Store not found or token not configured');
      stores = [data];
    } else {
      const { data } = await supabase.from('pos_stores').select('id, tiny_token').not('tiny_token', 'is', null);
      stores = data || [];
    }

    const results: any[] = [];

    for (const store of stores) {
      // Create sync log
      const { data: logEntry } = await supabase
        .from('pos_product_sync_log')
        .insert({ store_id: store.id, status: 'running' })
        .select('id')
        .single();
      const logId = logEntry?.id;

      try {
        const token = store.tiny_token;
        let page = 1;
        let totalSynced = 0;
        let hasMore = true;

        while (hasMore) {
          // Search all products page by page
          const searchResp = await fetch('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `token=${token}&formato=json&pagina=${page}`,
          });
          const searchData = await searchResp.json();

          if (searchData.retorno?.status === 'Erro') {
            hasMore = false;
            break;
          }

          const rawProducts = searchData.retorno?.produtos || [];
          if (rawProducts.length === 0) {
            hasMore = false;
            break;
          }

          // Get details for each product (includes variations)
          for (const item of rawProducts) {
            const p = item.produto;
            try {
              const detailResp = await fetch('https://api.tiny.com.br/api2/produto.obter.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `token=${token}&formato=json&id=${p.id}`,
              });
              const detailData = await detailResp.json();
              const full = detailData.retorno?.produto;

              if (!full) continue;

              const variations = full.variacoes || [];
              const rows: any[] = [];

              if (variations.length > 0) {
                for (const v of variations) {
                  const variation = v.variacao;
                  rows.push({
                    store_id: store.id,
                    tiny_id: full.id,
                    sku: variation.codigo || full.codigo || '',
                    name: full.nome,
                    variant: variation.grade?.tamanho
                      ? `${variation.grade?.cor || ''} ${variation.grade?.tamanho || ''}`.trim()
                      : variation.variacao || '',
                    size: variation.grade?.tamanho || null,
                    color: variation.grade?.cor || null,
                    category: full.classe_produto || null,
                    price: parseFloat(variation.preco || full.preco || '0'),
                    barcode: variation.gtin || full.gtin || '',
                    stock: parseFloat(variation.estoqueAtual || full.estoqueAtual || '0'),
                    image_url: full.anexos?.[0]?.anexo?.url || null,
                    is_active: full.situacao === 'A',
                    synced_at: new Date().toISOString(),
                  });
                }
              } else {
                rows.push({
                  store_id: store.id,
                  tiny_id: full.id,
                  sku: full.codigo || '',
                  name: full.nome,
                  variant: '',
                  size: null,
                  color: null,
                  category: full.classe_produto || null,
                  price: parseFloat(full.preco || '0'),
                  barcode: full.gtin || '',
                  stock: parseFloat(full.estoqueAtual || '0'),
                  image_url: full.anexos?.[0]?.anexo?.url || null,
                  is_active: full.situacao === 'A',
                  synced_at: new Date().toISOString(),
                });
              }

              // Upsert each row
              for (const row of rows) {
                await supabase
                  .from('pos_products')
                  .upsert(row, { onConflict: 'store_id,tiny_id,sku,variant' });
                totalSynced++;
              }
            } catch (e) {
              console.error('Error syncing product:', p.id, e);
            }

            // Tiny API rate limit: ~30 req/min, add small delay
            await new Promise(r => setTimeout(r, 350));
          }

          page++;
          // Tiny returns max 100 per page
          if (rawProducts.length < 100) hasMore = false;
        }

        // Update sync log
        if (logId) {
          await supabase.from('pos_product_sync_log').update({
            status: 'completed',
            products_synced: totalSynced,
            completed_at: new Date().toISOString(),
          }).eq('id', logId);
        }

        results.push({ store_id: store.id, products_synced: totalSynced, status: 'completed' });
      } catch (e) {
        console.error('Sync error for store:', store.id, e);
        if (logId) {
          await supabase.from('pos_product_sync_log').update({
            status: 'error',
            error_message: e.message,
            completed_at: new Date().toISOString(),
          }).eq('id', logId);
        }
        results.push({ store_id: store.id, status: 'error', error: e.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
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
