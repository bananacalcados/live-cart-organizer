import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Extract variant info from product name like "CHINELO CARTAGO DAKAR - 42 - Marrom"
function extractVariantFromName(name: string): { baseName: string; variant: string; size: string | null; color: string | null } {
  const parts = name.split(' - ');
  if (parts.length >= 3) {
    const baseName = parts.slice(0, parts.length - 2).join(' - ').trim();
    const size = parts[parts.length - 2]?.trim() || null;
    const color = parts[parts.length - 1]?.trim() || null;
    return { baseName, variant: `${size || ''} ${color || ''}`.trim(), size, color };
  }
  if (parts.length === 2) {
    const baseName = parts[0].trim();
    const last = parts[1]?.trim() || '';
    if (/^\d{2,3}$/.test(last)) {
      return { baseName, variant: last, size: last, color: null };
    }
    return { baseName, variant: last, size: null, color: last };
  }
  return { baseName: name, variant: '', size: null, color: null };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { store_id, resume_page, resume_log_id } = await req.json();

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
      let page = resume_page || 1;
      let logId = resume_log_id || null;
      let previousSynced = 0;

      if (logId) {
        const { data: existingLog } = await supabase
          .from('pos_product_sync_log')
          .select('products_synced')
          .eq('id', logId)
          .maybeSingle();
        previousSynced = existingLog?.products_synced || 0;
      }

      if (!logId) {
        const { data: logEntry } = await supabase
          .from('pos_product_sync_log')
          .insert({ store_id: store.id, status: 'running', products_synced: 0 })
          .select('id')
          .single();
        logId = logEntry?.id;
      } else {
        await supabase.from('pos_product_sync_log').update({ status: 'running' }).eq('id', logId);
      }

      try {
        const token = store.tiny_token;
        let totalSynced = 0;
        let hasMore = true;
        let totalPages = 1;

        while (hasMore) {
          // Fetch one page of 100 products from search listing
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

          // Get total pages from first response
          if (page === (resume_page || 1)) {
            totalPages = parseInt(searchData.retorno?.numero_paginas || '1');
            if (logId && page === 1) {
              await supabase.from('pos_product_sync_log').update({
                total_products: totalPages * 100,
              }).eq('id', logId);
            }
          }

          const rawProducts = searchData.retorno?.produtos || [];
          if (rawProducts.length === 0) {
            hasMore = false;
            break;
          }

          // Build rows directly from search listing — NO individual detail calls
          const rows: any[] = [];
          for (const item of rawProducts) {
            const p = item.produto;
            const nameInfo = extractVariantFromName(p.nome || '');
            rows.push({
              store_id: store.id,
              tiny_id: p.id,
              sku: p.codigo || '',
              name: p.nome || '',
              variant: nameInfo.variant,
              size: nameInfo.size,
              color: nameInfo.color,
              price: parseFloat(p.preco || '0'),
              barcode: p.gtin || p.codigo || '',
              stock: 0,
              is_active: p.situacao === 'A',
              synced_at: new Date().toISOString(),
            });
          }

          // Upsert all 100 products at once
          if (rows.length > 0) {
            await supabase
              .from('pos_products')
              .upsert(rows, { onConflict: 'store_id,tiny_id,sku,variant' });
          }

          totalSynced += rows.length;

          // Update progress
          if (logId) {
            await supabase.from('pos_product_sync_log').update({
              products_synced: previousSynced + totalSynced,
            }).eq('id', logId);
          }

          // Next page
          page++;
          if (page > totalPages) hasMore = false;

          // Small delay to respect rate limits (only 1 call per page now!)
          if (hasMore) await new Promise(r => setTimeout(r, 600));
        }

        // Done!
        if (logId) {
          await supabase.from('pos_product_sync_log').update({
            status: 'completed',
            products_synced: previousSynced + totalSynced,
            completed_at: new Date().toISOString(),
          }).eq('id', logId);
        }
        results.push({ store_id: store.id, products_synced: previousSynced + totalSynced, status: 'completed' });

      } catch (e) {
        console.error('Sync error for store:', store.id, e);
        if (logId) {
          // Save progress so it can resume
          await supabase.from('pos_product_sync_log').update({
            status: 'partial',
            error_message: JSON.stringify({ resume_page: page, resume_log_id: logId }),
            completed_at: new Date().toISOString(),
          }).eq('id', logId);
        }
        results.push({ store_id: store.id, status: 'partial', resume_page: page, resume_log_id: logId, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
