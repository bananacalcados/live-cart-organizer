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

    // Get all expedition orders that are NOT dispatched
    const { data: expeditionOrders, error: fetchErr } = await supabase
      .from('expedition_orders')
      .select('id, shopify_order_id, shopify_order_name')
      .neq('expedition_status', 'dispatched');

    if (fetchErr) throw fetchErr;
    if (!expeditionOrders || expeditionOrders.length === 0) {
      return new Response(JSON.stringify({ success: true, removed: 0, checked: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let removed = 0;

    // Check each order in Shopify (batch by 50 IDs)
    const batchSize = 50;
    for (let i = 0; i < expeditionOrders.length; i += batchSize) {
      const batch = expeditionOrders.slice(i, i + batchSize);
      const ids = batch.map(o => o.shopify_order_id).join(',');

      const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?ids=${ids}&status=any&fields=id,cancelled_at,financial_status&limit=250`;
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Shopify API error: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const shopifyOrders = data.orders || [];

      // Build a map of shopify order statuses
      const statusMap = new Map<string, { cancelled: boolean; financial: string }>();
      for (const so of shopifyOrders) {
        statusMap.set(String(so.id), {
          cancelled: !!so.cancelled_at,
          financial: so.financial_status,
        });
      }

      // Remove cancelled orders from expedition
      for (const eo of batch) {
        const status = statusMap.get(eo.shopify_order_id);
        if (status && (status.cancelled || status.financial === 'voided' || status.financial === 'refunded')) {
          await supabase.from('expedition_order_items').delete().eq('expedition_order_id', eo.id);
          await supabase.from('expedition_freight_quotes').delete().eq('expedition_order_id', eo.id);
          await supabase.from('expedition_orders').delete().eq('id', eo.id);
          removed++;
          console.log(`Removed cancelled order ${eo.shopify_order_name} (${eo.shopify_order_id})`);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, removed, checked: expeditionOrders.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error refreshing orders:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
