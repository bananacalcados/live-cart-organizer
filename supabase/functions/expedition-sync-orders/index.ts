import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SHOPIFY_STORE_DOMAIN = Deno.env.get('SHOPIFY_STORE_DOMAIN');
    const SHOPIFY_ACCESS_TOKEN = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
      throw new Error('Shopify credentials not configured');
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Create sync log
    const { data: syncLog } = await supabase
      .from('expedition_sync_log')
      .insert({ sync_type: 'shopify_orders', status: 'running' })
      .select()
      .single();

    let ordersSynced = 0;
    let pageInfo: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      // Fetch orders from Shopify (paid and unfulfilled)
      let url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?status=any&limit=50&fields=id,name,order_number,email,phone,financial_status,fulfillment_status,total_price,subtotal_price,total_shipping_price_set,total_discounts,created_at,line_items,shipping_address,note,customer,total_weight`;
      
      if (pageInfo) {
        url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?page_info=${pageInfo}&limit=50`;
      }

      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Shopify API error [${response.status}]: ${errText}`);
      }

      const data = await response.json();
      const orders = data.orders || [];

      for (const order of orders) {
        const shopifyOrderId = String(order.id);
        
        // Check if already synced
        const { data: existing } = await supabase
          .from('expedition_orders')
          .select('id, expedition_status')
          .eq('shopify_order_id', shopifyOrderId)
          .maybeSingle();

        // Determine expedition status based on financial_status
        const isPaid = order.financial_status === 'paid' || order.financial_status === 'partially_paid';
        const expeditionStatus = existing?.expedition_status || (isPaid ? 'approved' : 'pending_sync');

        const shippingAddress = order.shipping_address ? {
          name: order.shipping_address.name,
          address1: order.shipping_address.address1,
          address2: order.shipping_address.address2,
          city: order.shipping_address.city,
          province: order.shipping_address.province,
          zip: order.shipping_address.zip,
          country: order.shipping_address.country,
          phone: order.shipping_address.phone,
        } : null;

        const totalWeight = order.line_items?.reduce((sum: number, item: any) => sum + (item.grams || 0) * item.quantity, 0) || order.total_weight || 0;

        const orderData = {
          shopify_order_id: shopifyOrderId,
          shopify_order_number: String(order.order_number || ''),
          shopify_order_name: order.name || '',
          customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : (order.shipping_address?.name || ''),
          customer_email: order.email || '',
          customer_phone: order.phone || order.shipping_address?.phone || '',
          shipping_address: shippingAddress,
          financial_status: order.financial_status || 'pending',
          fulfillment_status: order.fulfillment_status || null,
          total_price: parseFloat(order.total_price || '0'),
          subtotal_price: parseFloat(order.subtotal_price || '0'),
          total_shipping: parseFloat(order.total_shipping_price_set?.shop_money?.amount || '0'),
          total_discount: parseFloat(order.total_discounts || '0'),
          total_weight_grams: totalWeight,
          shopify_created_at: order.created_at,
          expedition_status: expeditionStatus,
        };

        if (existing) {
          // Update existing - don't overwrite expedition_status if already progressed
          const updateData = { ...orderData };
          if (existing.expedition_status !== 'pending_sync') {
            delete (updateData as any).expedition_status;
          }
          await supabase
            .from('expedition_orders')
            .update(updateData)
            .eq('id', existing.id);
        } else {
          // Insert new order
          const { data: newOrder } = await supabase
            .from('expedition_orders')
            .insert(orderData)
            .select('id')
            .single();

          if (newOrder) {
            // Insert line items
            const items = (order.line_items || []).map((item: any) => ({
              expedition_order_id: newOrder.id,
              shopify_line_item_id: String(item.id),
              product_name: item.title || item.name || 'Unknown',
              variant_name: item.variant_title || null,
              sku: item.sku || null,
              barcode: null, // Will be fetched separately if needed
              quantity: item.quantity || 1,
              unit_price: parseFloat(item.price || '0'),
              weight_grams: (item.grams || 0) * (item.quantity || 1),
            }));

            if (items.length > 0) {
              await supabase.from('expedition_order_items').insert(items);
            }
          }
        }

        ordersSynced++;
      }

      // Check for pagination
      const linkHeader = response.headers.get('Link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/page_info=([^>&]+).*rel="next"/);
        pageInfo = match ? match[1] : null;
        hasNextPage = !!pageInfo;
      } else {
        hasNextPage = false;
      }
    }

    // Update sync log
    if (syncLog) {
      await supabase
        .from('expedition_sync_log')
        .update({
          status: 'completed',
          orders_synced: ordersSynced,
          completed_at: new Date().toISOString(),
        })
        .eq('id', syncLog.id);
    }

    return new Response(JSON.stringify({ success: true, orders_synced: ordersSynced }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error syncing orders:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
