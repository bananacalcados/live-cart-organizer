import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-topic, x-shopify-hmac-sha256, x-shopify-shop-domain",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const topic = req.headers.get("x-shopify-topic");
    const body = await req.json();

    console.log("Shopify webhook received:", topic);
    console.log("Body:", JSON.stringify(body, null, 2));

    // Handle checkout/order completion
    if (topic === "checkouts/create" || topic === "checkouts/update" || topic === "orders/create" || topic === "orders/paid") {
      const checkoutToken = body.token || body.checkout_token;
      const financialStatus = body.financial_status;
      
      console.log("Checkout token:", checkoutToken);
      console.log("Financial status:", financialStatus);

      // Only process if payment is complete
      if (financialStatus === "paid" || topic === "orders/paid") {
        // ── AUTO-INSERT INTO BETA EXPEDITION ──
        try {
          const shopifyOrderId = body.id?.toString();
          if (shopifyOrderId) {
            const { data: existingBeta } = await supabase
              .from("expedition_beta_orders")
              .select("id")
              .eq("shopify_order_id", shopifyOrderId)
              .maybeSingle();

            if (!existingBeta) {
              const shippingAddr = body.shipping_address ? {
                address1: body.shipping_address.address1,
                address2: body.shipping_address.address2,
                city: body.shipping_address.city,
                province: body.shipping_address.province,
                zip: body.shipping_address.zip,
                country: body.shipping_address.country,
                name: body.shipping_address.name,
                phone: body.shipping_address.phone,
              } : null;

              const custName = body.customer
                ? `${body.customer.first_name || ""} ${body.customer.last_name || ""}`.trim()
                : body.shipping_address?.name || "";

              const { data: inserted } = await supabase
                .from("expedition_beta_orders")
                .insert({
                  shopify_order_id: shopifyOrderId,
                  shopify_order_name: body.name,
                  shopify_order_number: body.order_number?.toString(),
                  shopify_created_at: body.created_at,
                  customer_name: custName,
                  customer_email: body.customer?.email || body.email,
                  customer_phone: body.customer?.phone || body.shipping_address?.phone || body.phone,
                  shipping_address: shippingAddr,
                  financial_status: body.financial_status || "paid",
                  fulfillment_status: body.fulfillment_status || "unfulfilled",
                  expedition_status: "approved",
                  subtotal_price: parseFloat(body.subtotal_price || "0"),
                  total_price: parseFloat(body.total_price || "0"),
                  total_discount: parseFloat(body.total_discounts || "0"),
                  total_shipping: (body.shipping_lines || []).reduce((s: number, l: any) => s + parseFloat(l.price || "0"), 0),
                  total_weight_grams: body.total_weight || 0,
                 has_gift: body.note?.toLowerCase().includes("brinde") || body.tags?.toLowerCase().includes("gift") || false,
                 shipping_method: (body.shipping_lines || [])[0]?.title || null,
                 })
                 .select()
                 .single();

              if (inserted && body.line_items?.length > 0) {
                const betaItems = body.line_items.map((li: any) => ({
                  expedition_order_id: inserted.id,
                  shopify_line_item_id: li.id?.toString(),
                  product_name: li.title || li.name,
                  variant_name: li.variant_title,
                  sku: li.sku,
                  quantity: li.quantity,
                  unit_price: parseFloat(li.price || "0"),
                  weight_grams: li.grams || 0,
                }));
                await supabase.from("expedition_beta_order_items").insert(betaItems);
              }
              console.log("Beta expedition order created:", body.name);
            }
          }
        } catch (betaErr: any) {
          console.error("Beta expedition insert error (non-blocking):", betaErr.message);
        }
        // ── END BETA EXPEDITION ──
        // Find order by checkout token
        const { data: orders, error } = await supabase
          .from("orders")
          .select("*")
          .eq("checkout_token", checkoutToken);

        if (error) {
          console.error("Error finding order:", error);
          throw error;
        }

        if (orders && orders.length > 0) {
          const order = orders[0];
          
          // Update order to paid status
          const { error: updateError } = await supabase
            .from("orders")
            .update({
              is_paid: true,
              paid_at: new Date().toISOString(),
              stage: "paid"
            })
            .eq("id", order.id);

          if (updateError) {
            console.error("Error updating order:", updateError);
            throw updateError;
          }

          console.log("Order marked as paid:", order.id);
        } else {
          console.log("No order found for checkout token:", checkoutToken);
        }

        // Trigger shopify_purchase automation flows
        const customerPhone = body.phone || body.billing_address?.phone || body.shipping_address?.phone || body.customer?.phone;
        const customerName = body.customer?.first_name || body.billing_address?.first_name || "";
        const customerEmail = body.customer?.email || body.email || "";
        const lineItems = body.line_items || [];
        const productNames = lineItems.map((li: any) => li.title || li.name).join(", ");
        const productTags = lineItems.map((li: any) => li.vendor).filter(Boolean);

        if (customerPhone) {
          // Find active automation flows with shopify_purchase trigger
          const { data: flows } = await supabase
            .from("automation_flows")
            .select("*")
            .eq("trigger_type", "shopify_purchase")
            .eq("is_active", true);

          if (flows && flows.length > 0) {
            for (const flow of flows) {
              const triggerConfig = flow.trigger_config || {};
              
              // Check product tag filter if configured
              if (triggerConfig.product_tag) {
                const hasMatchingTag = productTags.some((t: string) => 
                  t.toLowerCase().includes(triggerConfig.product_tag.toLowerCase())
                );
                if (!hasMatchingTag) continue;
              }

              // Log the automation execution
              await supabase.from("automation_executions").insert({
                flow_id: flow.id,
                status: "triggered",
                result: {
                  trigger: "shopify_purchase",
                  customer_phone: customerPhone,
                  customer_name: customerName,
                  customer_email: customerEmail,
                  products: productNames,
                  order_total: body.total_price,
                  shopify_order_id: body.id?.toString(),
                  shopify_order_name: body.name,
                },
              });

              console.log(`Automation flow "${flow.name}" triggered for shopify_purchase`);
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
