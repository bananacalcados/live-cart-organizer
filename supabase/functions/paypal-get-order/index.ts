import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { paypalOrderId } = await req.json();

    if (!paypalOrderId) {
      throw new Error("paypalOrderId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // First try to find by paypal_order_id
    let { data: payment, error } = await supabase
      .from("paypal_payments")
      .select("*, order:orders(*, customer:customers(*))")
      .eq("paypal_order_id", paypalOrderId)
      .maybeSingle();

    // If not found, try to find by checkout_token on the orders table
    if (!payment) {
      const { data: order } = await supabase
        .from("orders")
        .select("id")
        .eq("checkout_token", paypalOrderId)
        .maybeSingle();

      if (order) {
        // Find the latest payment for this order
        const { data: paymentByOrder } = await supabase
          .from("paypal_payments")
          .select("*, order:orders(*, customer:customers(*))")
          .eq("order_id", order.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (paymentByOrder) {
          payment = paymentByOrder;
          error = null;
        }
      }
    }

    if (error || !payment) {
      throw new Error("Payment not found");
    }

    const order = payment.order as Record<string, unknown>;
    const customer = (order?.customer || {}) as Record<string, unknown>;
    const products = (order?.products || []) as Array<{
      title: string;
      variant: string;
      price: number;
      quantity: number;
      image?: string;
    }>;

    const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID") || "";

    return new Response(
      JSON.stringify({
        paypalOrderId: payment.paypal_order_id,
        paypalClientId,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        orderId: payment.order_id,
        customerName: customer.instagram_handle || "Cliente",
        products: products.map((p) => ({
          title: p.title,
          variant: p.variant,
          price: p.price,
          quantity: p.quantity,
          image: p.image,
        })),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching order:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
