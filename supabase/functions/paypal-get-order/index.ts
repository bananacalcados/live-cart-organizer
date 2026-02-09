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
    const { paypalOrderId } = await req.json();

    if (!paypalOrderId) {
      throw new Error("paypalOrderId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch payment record with order details
    const { data: payment, error } = await supabase
      .from("paypal_payments")
      .select("*, order:orders(*, customer:customers(*))")
      .eq("paypal_order_id", paypalOrderId)
      .maybeSingle();

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
