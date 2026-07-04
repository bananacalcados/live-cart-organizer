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

  try {
    const { store_id, sale_id, cancel_tiny_only } = await req.json();
    if (!store_id || !sale_id) throw new Error('store_id and sale_id are required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get sale details
    const { data: sale } = await supabase
      .from('pos_sales')
      .select('*')
      .eq('id', sale_id)
      .single();

    if (!sale) throw new Error('Sale not found');

    const { data: store } = await supabase
      .from('pos_stores')
      .select('tiny_token')
      .eq('id', store_id)
      .single();

    if (!store?.tiny_token) throw new Error('Store token not configured');
    const token = store.tiny_token;

    const results: string[] = [];

    // 1. If there's a NFC-e invoice, cancel it first
    if (sale.tiny_invoice_id) {
      try {
        // Try to cancel the invoice
        const cancelResp = await fetch('https://api.tiny.com.br/api2/nota.fiscal.cancelar.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&id=${sale.tiny_invoice_id}&motivo=Cancelamento de venda no PDV`,
        });
        const cancelData = await cancelResp.json();
        console.log('Cancel invoice response:', JSON.stringify(cancelData));

        if (cancelData.retorno?.status === 'OK' || cancelData.retorno?.status === 'Processado') {
          results.push('NFC-e cancelada com sucesso');
        } else {
          // If cancel fails, try to void/inutilize
          const errorMsg = cancelData.retorno?.erros?.[0]?.erro || '';
          console.log('Cancel failed, trying to get invoice status:', errorMsg);
          
          // Get invoice details to check status
          const detailResp = await fetch('https://api.tiny.com.br/api2/nota.fiscal.obter.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `token=${token}&formato=json&id=${sale.tiny_invoice_id}`,
          });
          const detailData = await detailResp.json();
          const nf = detailData.retorno?.nota_fiscal || {};
          
          if (nf.situacao === 'cancelada' || nf.situacao === 'Cancelada') {
            results.push('NFC-e já estava cancelada');
          } else {
            results.push(`Aviso: não foi possível cancelar NFC-e (${errorMsg || 'erro desconhecido'}). Verifique manualmente no Tiny.`);
          }
        }
      } catch (invoiceError) {
        console.error('Error canceling invoice:', invoiceError);
        results.push('Aviso: erro ao tentar cancelar NFC-e. Verifique manualmente no Tiny.');
      }
    }

    // 2. Cancel the order in Tiny
    if (sale.tiny_order_id) {
      try {
        const cancelOrderResp = await fetch('https://api.tiny.com.br/api2/pedido.alterar.situacao.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${token}&formato=json&id=${sale.tiny_order_id}&situacao=cancelado`,
        });
        const cancelOrderData = await cancelOrderResp.json();
        console.log('Cancel order response:', JSON.stringify(cancelOrderData));

        if (cancelOrderData.retorno?.status === 'OK' || cancelOrderData.retorno?.status === 'Processado') {
          results.push('Pedido cancelado no Tiny');
        } else {
          const errorMsg = cancelOrderData.retorno?.erros?.[0]?.erro || JSON.stringify(cancelOrderData.retorno);
          results.push(`Aviso: erro ao cancelar pedido no Tiny (${errorMsg})`);
        }
      } catch (orderError) {
        console.error('Error canceling order in Tiny:', orderError);
        results.push('Aviso: erro ao cancelar pedido no Tiny');
      }
    }

    // If cancel_tiny_only, stop here — don't touch local data
    if (cancel_tiny_only) {
      return new Response(JSON.stringify({
        success: true,
        messages: results,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Restore stock in pos_products
    const { data: saleItems } = await supabase
      .from('pos_sale_items')
      .select('sku, quantity')
      .eq('sale_id', sale_id);

    if (saleItems && saleItems.length > 0) {
      for (const item of saleItems) {
        if (item.sku) {
          const { data: product } = await supabase
            .from('pos_products')
            .select('id, stock')
            .eq('store_id', store_id)
            .eq('sku', item.sku)
            .maybeSingle();

          if (product) {
            await supabase
              .from('pos_products')
              .update({ stock: (product.stock || 0) + item.quantity, synced_at: new Date().toISOString() })
              .eq('id', product.id);
          }
        }
      }
      results.push('Estoque local restaurado');
    }

    // 4. Reverse gamification points
    if (sale.seller_id) {
      const { data: gamification } = await supabase
        .from('pos_gamification')
        .select('id, total_points, sales_count')
        .eq('seller_id', sale.seller_id)
        .eq('store_id', store_id)
        .maybeSingle();

      if (gamification) {
        const pointsToRemove = 10; // same as awarded on sale
        await supabase.from('pos_gamification').update({
          total_points: Math.max(0, gamification.total_points - pointsToRemove),
          sales_count: Math.max(0, gamification.sales_count - 1),
        }).eq('id', gamification.id);
        results.push('Pontuação de gamificação revertida');
      }
    }

    // 5. Delete sale items and sale from local DB
    await supabase.from('pos_sale_items').delete().eq('sale_id', sale_id);
    await supabase.from('pos_sales').delete().eq('id', sale_id);
    results.push('Venda excluída do sistema');

    return new Response(JSON.stringify({
      success: true,
      messages: results,
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
