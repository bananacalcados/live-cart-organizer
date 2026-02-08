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
