import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const shopifyDomain = Deno.env.get("SHOPIFY_STORE_DOMAIN")!;
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN")!;

    // Fetch unfulfilled orders from Shopify
    const url = `https://${shopifyDomain}/admin/api/2024-01/orders.json?status=open&fulfillment_status=unfulfilled&financial_status=paid&limit=250`;
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API error: ${res.status} - ${text}`);
    }

    const { orders: shopifyOrders } = await res.json();
    console.log(`Fetched ${shopifyOrders?.length || 0} unfulfilled orders from Shopify`);

    let synced = 0;
    let skipped = 0;

    for (const order of (shopifyOrders || [])) {
      const shopifyOrderId = order.id.toString();

      // Check if already exists
      const { data: existing } = await supabase
        .from("expedition_beta_orders")
        .select("id")
        .eq("shopify_order_id", shopifyOrderId)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Insert order
      const shippingAddress = order.shipping_address ? {
        address1: order.shipping_address.address1,
        address2: order.shipping_address.address2,
        city: order.shipping_address.city,
        province: order.shipping_address.province,
        zip: order.shipping_address.zip,
        country: order.shipping_address.country,
        name: order.shipping_address.name,
        phone: order.shipping_address.phone,
      } : null;

      const { data: inserted, error: insertError } = await supabase
        .from("expedition_beta_orders")
        .insert({
          shopify_order_id: shopifyOrderId,
          shopify_order_name: order.name,
          shopify_order_number: order.order_number?.toString(),
          shopify_created_at: order.created_at,
          customer_name: order.customer ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() : order.shipping_address?.name,
          customer_email: order.customer?.email || order.email,
          customer_phone: order.customer?.phone || order.shipping_address?.phone || order.phone,
          shipping_address: shippingAddress,
          financial_status: order.financial_status || "paid",
          fulfillment_status: order.fulfillment_status || "unfulfilled",
          expedition_status: "approved",
          subtotal_price: parseFloat(order.subtotal_price || "0"),
          total_price: parseFloat(order.total_price || "0"),
          total_discount: parseFloat(order.total_discounts || "0"),
          total_shipping: order.shipping_lines?.reduce((s: number, l: any) => s + parseFloat(l.price || "0"), 0) || 0,
          total_weight_grams: order.total_weight || 0,
          has_gift: order.note?.toLowerCase().includes("brinde") || order.tags?.toLowerCase().includes("gift") || false,
        })
        .select()
        .single();

      if (insertError) {
        console.error(`Error inserting order ${order.name}:`, insertError);
        continue;
      }

      // Insert line items
      if (inserted && order.line_items?.length > 0) {
        const items = order.line_items.map((li: any) => ({
          expedition_order_id: inserted.id,
          shopify_line_item_id: li.id?.toString(),
          product_name: li.title || li.name,
          variant_name: li.variant_title,
          sku: li.sku,
          barcode: null,
          quantity: li.quantity,
          unit_price: parseFloat(li.price || "0"),
          weight_grams: li.grams || 0,
        }));

        await supabase.from("expedition_beta_order_items").insert(items);
      }

      synced++;
    }

    console.log(`Sync complete: ${synced} synced, ${skipped} skipped`);

    return new Response(JSON.stringify({ success: true, synced, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Sync error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
