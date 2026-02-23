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

    // Accept optional date filters
    const body = await req.json().catch(() => ({}));
    const { created_at_min, created_at_max } = body;

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
      let url: string;
      if (pageInfo) {
        url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?page_info=${pageInfo}&limit=50`;
      } else {
        const params = new URLSearchParams({
          status: 'any',
          limit: '50',
          fields: 'id,name,order_number,email,phone,financial_status,fulfillment_status,total_price,subtotal_price,total_shipping_price_set,total_discounts,created_at,line_items,shipping_address,note,note_attributes,customer,total_weight,token,checkout_token',
        });
        if (created_at_min) params.set('created_at_min', created_at_min);
        if (created_at_max) params.set('created_at_max', created_at_max);
        url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?${params.toString()}`;
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

        // Extract CPF from note_attributes (sent by our system) or from note text
        let customerCpf: string | null = null;
        if (order.note_attributes && Array.isArray(order.note_attributes)) {
          const cpfAttr = order.note_attributes.find((a: any) => a.name?.toLowerCase() === 'cpf');
          if (cpfAttr?.value) customerCpf = cpfAttr.value;
        }
        if (!customerCpf && order.note) {
          const cpfMatch = order.note.match(/CPF:\s*([\d.\-\/]+)/);
          if (cpfMatch) customerCpf = cpfMatch[1];
        }

        const orderData = {
          shopify_order_id: shopifyOrderId,
          shopify_order_number: String(order.order_number || ''),
          shopify_order_name: order.name || '',
          customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : (order.shipping_address?.name || ''),
          customer_email: order.email || '',
          customer_phone: order.phone || order.shipping_address?.phone || '',
          customer_cpf: customerCpf,
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

        // Try to match with CRM order to get live/event/gift info
        const checkoutToken = order.token || order.checkout_token;
        let liveData: any = {};
        if (checkoutToken) {
          const { data: crmOrder } = await supabase
            .from('orders')
            .select('event_id, has_gift, events(name, created_at)')
            .eq('checkout_token', checkoutToken)
            .maybeSingle();

          if (crmOrder) {
            const evt = (crmOrder as any).events;
            liveData = {
              is_from_live: true,
              source_event_name: evt?.name || null,
              source_event_date: evt?.created_at || null,
              has_gift: crmOrder.has_gift || false,
            };
          }
        }

        if (existing) {
          // Update existing - don't overwrite expedition_status if already progressed
          const updateData = { ...orderData, ...liveData };
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
            .insert({ ...orderData, ...liveData })
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
              barcode: null,
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
