import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://www.bananacalcados.com.br",
  "https://bananacalcados.com.br",
  "https://live-cart-organizer.lovable.app",
  "https://checkout.bananacalcados.com.br",
  "https://tqxhcyuxgqbzqwoidpie.supabase.co",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const { paypalOrderId } = await req.json();

    if (!paypalOrderId) {
      throw new Error("paypalOrderId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID") || "";

    // First try to find by paypal_order_id
    let { data: payment } = await supabase
      .from("paypal_payments")
      .select("*, order:orders(*, customer:customers(*))")
      .eq("paypal_order_id", paypalOrderId)
      .maybeSingle();

    // If not found, try by checkout_token
    if (!payment) {
      const { data: order } = await supabase
        .from("orders")
        .select("id")
        .eq("checkout_token", paypalOrderId)
        .maybeSingle();

      if (order) {
        // Try to find a PayPal payment for this order
        const { data: paymentByOrder } = await supabase
          .from("paypal_payments")
          .select("*, order:orders(*, customer:customers(*))")
          .eq("order_id", order.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (paymentByOrder) {
          payment = paymentByOrder;
        } else {
          // No PayPal payment — load order directly (PIX-only flow)
          const { data: fullOrder, error: orderError } = await supabase
            .from("orders")
            .select("*, customer:customers(*)")
            .eq("id", order.id)
            .single();

          if (orderError || !fullOrder) {
            throw new Error("Order not found");
          }

          const customer = fullOrder.customer as Record<string, unknown> | null;
          const products = (fullOrder.products || []) as Array<{
            title: string; variant: string; price: number; quantity: number; image?: string;
          }>;

          const subtotal = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
          let discountAmount = 0;
          if (fullOrder.discount_type && fullOrder.discount_value) {
            discountAmount = fullOrder.discount_type === "percentage"
              ? subtotal * (fullOrder.discount_value / 100)
              : fullOrder.discount_value;
          }
          const totalAmount = Math.round(Math.max(0, subtotal - discountAmount) * 100) / 100;

          return new Response(
            JSON.stringify({
              paypalOrderId: null,
              paypalClientId,
              status: fullOrder.is_paid ? "captured" : "created",
              amount: totalAmount,
              currency: "BRL",
              orderId: fullOrder.id,
              customerName: customer?.instagram_handle || "Cliente",
              products: products.map((p) => ({
                title: p.title, variant: p.variant, price: p.price, quantity: p.quantity, image: p.image,
              })),
            }),
            { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
          );
        }
      }
    }

    if (!payment) {
      throw new Error("Payment not found");
    }

    const order = payment.order as Record<string, unknown>;
    const customer = (order?.customer || {}) as Record<string, unknown>;
    const products = (order?.products || []) as Array<{
      title: string; variant: string; price: number; quantity: number; image?: string;
    }>;

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
          title: p.title, variant: p.variant, price: p.price, quantity: p.quantity, image: p.image,
        })),
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching order:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 404, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
