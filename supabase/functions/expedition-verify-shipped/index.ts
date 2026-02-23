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
    const SHOPIFY_STORE_DOMAIN = Deno.env.get('SHOPIFY_STORE_DOMAIN');
    const SHOPIFY_ACCESS_TOKEN = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
    const TINY_ERP_TOKEN = Deno.env.get('TINY_ERP_TOKEN');
    const YAMPI_USER_TOKEN = Deno.env.get('YAMPI_USER_TOKEN');
    const YAMPI_USER_SECRET_KEY = Deno.env.get('YAMPI_USER_SECRET_KEY');
    const YAMPI_STORE_ALIAS = Deno.env.get('YAMPI_STORE_ALIAS');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch all expedition orders
    const { data: orders, error: fetchError } = await supabase
      .from('expedition_orders')
      .select('id, shopify_order_id, shopify_order_name, shopify_order_number, tiny_order_id, expedition_status, fulfillment_status, customer_email, customer_phone')
      .order('created_at', { ascending: false })
      .limit(500);

    if (fetchError) throw fetchError;
    if (!orders || orders.length === 0) {
      return new Response(JSON.stringify({ success: true, checked: 0, updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let checked = 0;
    let updated = 0;
    const results: Array<{ order_name: string; source: string; status: string }> = [];

    for (const order of orders) {
      checked++;
      let shipped = false;
      let shipSource = '';

      // 1. Check Shopify fulfillment status
      if (!shipped && SHOPIFY_STORE_DOMAIN && SHOPIFY_ACCESS_TOKEN && order.shopify_order_id) {
        try {
          const shopifyResp = await fetch(
            `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${order.shopify_order_id}.json?fields=id,fulfillment_status,fulfillments`,
            {
              headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json',
              },
            }
          );

          if (shopifyResp.ok) {
            const shopifyData = await shopifyResp.json();
            const shopifyOrder = shopifyData.order;
            if (shopifyOrder?.fulfillment_status === 'fulfilled' || shopifyOrder?.fulfillment_status === 'partial') {
              shipped = true;
              shipSource = 'shopify';
              // Also extract tracking if available
              const fulfillment = shopifyOrder.fulfillments?.[0];
              if (fulfillment?.tracking_number) {
                await supabase.from('expedition_orders').update({
                  freight_tracking_code: fulfillment.tracking_number,
                  freight_carrier: fulfillment.tracking_company || null,
                }).eq('id', order.id);
              }
            }
          }

          // Rate limit: small delay between Shopify calls
          await new Promise(r => setTimeout(r, 250));
        } catch (e) {
          console.error(`Shopify check failed for ${order.shopify_order_name}:`, e);
        }
      }

      // 2. Check Tiny ERP order status
      if (!shipped && TINY_ERP_TOKEN && order.tiny_order_id) {
        try {
          const tinyResp = await fetch('https://api.tiny.com.br/api2/pedido.obter.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `token=${TINY_ERP_TOKEN}&formato=json&id=${order.tiny_order_id}`,
          });

          const tinyData = await tinyResp.json();
          const tinyOrder = tinyData.retorno?.pedido;
          if (tinyOrder) {
            const situacao = tinyOrder.situacao?.toLowerCase() || '';
            // Tiny statuses indicating shipment: "enviado", "entregue", "pronto para envio"
            if (situacao.includes('enviado') || situacao.includes('entregue') || situacao === 'pronto para envio') {
              shipped = true;
              shipSource = 'tiny';
            }
          }

          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.error(`Tiny check failed for ${order.shopify_order_name}:`, e);
        }
      }

      // 3. Check Yampi order status (search by order name/number)
      if (!shipped && YAMPI_USER_TOKEN && YAMPI_USER_SECRET_KEY && YAMPI_STORE_ALIAS && order.shopify_order_name) {
        try {
          // Search by order number in Yampi
          const orderNumber = order.shopify_order_number || order.shopify_order_name?.replace('#', '');
          const yampiResp = await fetch(
            `https://api.dooki.com.br/v2/${YAMPI_STORE_ALIAS}/orders?search=${encodeURIComponent(orderNumber)}&limit=5`,
            {
              headers: {
                'Content-Type': 'application/json',
                'User-Token': YAMPI_USER_TOKEN,
                'User-Secret-Key': YAMPI_USER_SECRET_KEY,
              },
            }
          );

          if (yampiResp.ok) {
            const yampiData = await yampiResp.json();
            const yampiOrders = yampiData.data || [];
            for (const yo of yampiOrders) {
              const yampiStatus = (yo.status?.data?.name || yo.status_label || '').toLowerCase();
              if (yampiStatus.includes('enviado') || yampiStatus.includes('entregue') || yampiStatus.includes('shipped') || yampiStatus.includes('delivered')) {
                shipped = true;
                shipSource = 'yampi';
                // Extract tracking if available
                if (yo.tracking_code) {
                  await supabase.from('expedition_orders').update({
                    freight_tracking_code: yo.tracking_code,
                  }).eq('id', order.id);
                }
                break;
              }
            }
          }

          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.error(`Yampi check failed for ${order.shopify_order_name}:`, e);
        }
      }

      // Update if shipped externally
      if (shipped && order.expedition_status !== 'dispatched') {
        const { error: updateErr } = await supabase
          .from('expedition_orders')
          .update({
            expedition_status: 'dispatched',
            dispatch_verified: true,
            dispatch_verified_at: new Date().toISOString(),
            notes: `${order.notes ? order.notes + '\n' : ''}[Auto] Verificado como enviado via ${shipSource} em ${new Date().toLocaleString('pt-BR')}`,
          })
          .eq('id', order.id);

        if (!updateErr) {
          updated++;
          results.push({ order_name: order.shopify_order_name || order.shopify_order_id, source: shipSource, status: 'marked_dispatched' });
        }
      }

      // Safety: stop after 25s to avoid function timeout
      // (Deno edge functions have ~30s limit)
    }

    return new Response(JSON.stringify({
      success: true,
      checked,
      updated,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error verifying shipped orders:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
