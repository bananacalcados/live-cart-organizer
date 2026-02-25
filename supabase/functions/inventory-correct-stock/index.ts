import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Processes pending items from inventory_correction_queue one by one with throttling.
 * Designed to be called repeatedly until all items are processed.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { count_id, batch_size = 10 } = await req.json();
    if (!count_id) throw new Error('count_id is required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get pending items
    const { data: items, error: fetchError } = await supabase
      .from('inventory_correction_queue')
      .select('*, pos_stores:store_id(tiny_token)')
      .eq('count_id', count_id)
      .in('status', ['pending', 'error'])
      .lt('attempts', 5)
      .order('created_at', { ascending: true })
      .limit(batch_size);

    if (fetchError) throw fetchError;
    if (!items || items.length === 0) {
      // Update count status to completed
      await supabase.from('inventory_counts').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', count_id);
      return new Response(JSON.stringify({ success: true, processed: 0, remaining: 0, done: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    let errors = 0;

    for (const item of items) {
      const token = (item as any).pos_stores?.tiny_token;
      if (!token) {
        await supabase.from('inventory_correction_queue').update({
          status: 'error', error_message: 'Store token not found', attempts: item.attempts + 1
        }).eq('id', item.id);
        errors++;
        continue;
      }

      // Mark as processing
      await supabase.from('inventory_correction_queue').update({
        status: 'processing', attempts: item.attempts + 1
      }).eq('id', item.id);

      try {
        // Build estoque payload as JSON (Tiny expects {"estoque": {...}})
        const estoqueJson = JSON.stringify({
          estoque: {
            idProduto: Number(item.product_id),
            tipo: 'B',
            quantidade: item.new_quantity,
            observacoes: 'Balanco de estoque - correcao automatica',
          }
        });

        const resp = await fetch('https://api.tiny.com.br/api2/produto.atualizar.estoque.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&estoque=${encodeURIComponent(estoqueJson)}`,
        });

        const data = await resp.json();
        console.log(`Stock update for product ${item.product_id}:`, data.retorno?.status);

        if (data.retorno?.status === 'Erro') {
          const errMsg = data.retorno?.erros?.[0]?.erro || 'Unknown Tiny error';
          await supabase.from('inventory_correction_queue').update({
            status: 'error', error_message: errMsg
          }).eq('id', item.id);

          // Also update count item
          await supabase.from('inventory_count_items').update({
            correction_status: 'error', correction_error: errMsg
          }).eq('id', item.count_item_id);

          errors++;
        } else {
          const newStock = data.retorno?.registros?.[0]?.registro?.saldoEstoque;
          await supabase.from('inventory_correction_queue').update({
            status: 'completed', processed_at: new Date().toISOString()
          }).eq('id', item.id);

          // Update count item
          await supabase.from('inventory_count_items').update({
            correction_status: 'corrected', corrected_at: new Date().toISOString()
          }).eq('id', item.count_item_id);

          processed++;
        }
      } catch (e) {
        console.error(`Error correcting product ${item.product_id}:`, e);
        await supabase.from('inventory_correction_queue').update({
          status: 'error', error_message: e.message
        }).eq('id', item.id);
        await supabase.from('inventory_count_items').update({
          correction_status: 'error', correction_error: e.message
        }).eq('id', item.count_item_id);
        errors++;
      }

      // Throttle: wait 2s between API calls to respect rate limits (~30/min)
      await new Promise(r => setTimeout(r, 2000));
    }

    // Update count stats
    const { data: stats } = await supabase
      .from('inventory_correction_queue')
      .select('status')
      .eq('count_id', count_id);

    const completed = stats?.filter(s => s.status === 'completed').length || 0;
    const errorCount = stats?.filter(s => s.status === 'error' && (s as any).attempts >= 5).length || 0;
    const remaining = stats?.filter(s => ['pending', 'processing', 'error'].includes(s.status)).length || 0;

    await supabase.from('inventory_counts').update({
      corrected_products: completed,
      correction_errors: errorCount,
    }).eq('id', count_id);

    return new Response(JSON.stringify({
      success: true, processed, errors, remaining: remaining - processed,
      done: remaining - processed <= 0
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
