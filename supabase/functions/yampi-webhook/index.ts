import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-yampi-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    
    // Log the webhook payload for debugging
    console.log("Yampi webhook received:", JSON.stringify(body, null, 2));

    // Extract event type from Yampi webhook
    const eventType = body.event || body.type;
    console.log("Event type:", eventType);

    // Handle different event types
    // Common Yampi events: order_approved, order_paid, order_cancelled, order_refunded
    if (
      eventType === "order_approved" ||
      eventType === "order_paid" ||
      eventType === "payment_approved" ||
      eventType === "transaction_approved"
    ) {
      // Extract order info from webhook payload
      const orderData = body.data?.order || body.order || body.data;
      const metadata = orderData?.metadata || body.metadata;
      const internalOrderId = metadata?.order_id;

      console.log("Order data:", JSON.stringify(orderData, null, 2));
      console.log("Internal order ID from metadata:", internalOrderId);

      if (internalOrderId) {
        // Update order status in database
        const { data: order, error: fetchError } = await supabase
          .from("orders")
          .select("*")
          .eq("id", internalOrderId)
          .single();

        if (fetchError) {
          console.error("Error fetching order:", fetchError);
        } else if (order) {
          console.log("Found order:", order.id);

          // Update order to paid status
          const { error: updateError } = await supabase
            .from("orders")
            .update({
              is_paid: true,
              paid_at: new Date().toISOString(),
              stage: "paid",
            })
            .eq("id", order.id);

          if (updateError) {
            console.error("Error updating order:", updateError);
            throw updateError;
          }

          console.log("Order marked as paid:", order.id);
        }
      } else {
        console.log("No internal order ID found in metadata, trying to match by other fields...");
        
        // Try to match by customer phone or email if available
        const customerPhone = orderData?.customer?.phone || body.customer?.phone;
        const customerEmail = orderData?.customer?.email || body.customer?.email;
        
        if (customerPhone) {
          // Normalize phone number (remove non-digits)
          const normalizedPhone = customerPhone.replace(/\D/g, "");
          
          // Find orders with matching customer WhatsApp
          const { data: customers, error: customerError } = await supabase
            .from("customers")
            .select("id, whatsapp")
            .or(`whatsapp.ilike.%${normalizedPhone}%`);

          if (!customerError && customers && customers.length > 0) {
            // Find recent unpaid orders for these customers (last 48h only)
            const customerIds = customers.map((c) => c.id);
            const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
            
            const { data: orders, error: ordersError } = await supabase
              .from("orders")
              .select("*")
              .in("customer_id", customerIds)
              .eq("is_paid", false)
              .gte("created_at", cutoff)
              .order("created_at", { ascending: false })
              .limit(1);

            if (!ordersError && orders && orders.length > 0) {
              const order = orders[0];
              
              const { error: updateError } = await supabase
                .from("orders")
                .update({
                  is_paid: true,
                  paid_at: new Date().toISOString(),
                  stage: "paid",
                })
                .eq("id", order.id);

              if (!updateError) {
                console.log("Order matched by phone and marked as paid:", order.id);
            } else {
              console.error(`[yampi-webhook] Nenhum pedido recente encontrado para telefone ${normalizedPhone}. Payload: ${JSON.stringify(body).substring(0, 300)}`);
            }
          }
      }
    } else if (eventType === "order_cancelled" || eventType === "order_refunded") {
      // Handle cancellation/refund if needed
      const metadata = body.data?.order?.metadata || body.metadata;
      const internalOrderId = metadata?.order_id;

      if (internalOrderId) {
        console.log("Order cancelled/refunded:", internalOrderId);
      }
    } else if (eventType === "abandoned_cart" || eventType === "checkout_abandoned" || eventType === "cart_abandoned") {
      // Handle Yampi abandoned cart → trigger automation
      console.log("Abandoned cart event received");
      
      const cartData = body.data?.cart || body.data?.checkout || body.data || {};
      const customerPhone = cartData.customer?.phone || cartData.phone || body.customer?.phone;
      const customerName = cartData.customer?.name || cartData.customer?.first_name || "";
      const customerEmail = cartData.customer?.email || "";
      const cartItems = cartData.items || cartData.line_items || [];
      const cartTotal = cartData.total || cartData.total_price || 0;
      const cartUrl = cartData.checkout_url || cartData.url || "";

      if (customerPhone) {
        // Find active automation flows with yampi_abandoned_cart trigger
        const { data: flows } = await supabase
          .from("automation_flows")
          .select("*")
          .eq("trigger_type", "yampi_abandoned_cart")
          .eq("is_active", true);

        if (flows && flows.length > 0) {
          for (const flow of flows) {
            await supabase.from("automation_executions").insert({
              flow_id: flow.id,
              status: "triggered",
              result: {
                trigger: "yampi_abandoned_cart",
                customer_phone: customerPhone,
                customer_name: customerName,
                customer_email: customerEmail,
                cart_total: cartTotal,
                cart_url: cartUrl,
                items: cartItems.map((i: any) => i.name || i.title || "").join(", "),
              },
            });

            console.log(`Automation flow "${flow.name}" triggered for yampi_abandoned_cart`);
          }
        }
      } else {
        console.log("No customer phone in abandoned cart event, skipping automation trigger");
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
