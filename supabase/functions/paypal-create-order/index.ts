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

async function getPayPalAccessToken(): Promise<string> {
  const clientId = (Deno.env.get("PAYPAL_CLIENT_ID") || "").trim();
  const clientSecret = (Deno.env.get("PAYPAL_CLIENT_SECRET") || "").trim();
  const baseUrl = (Deno.env.get("PAYPAL_BASE_URL") || "https://api-m.paypal.com").trim();

  console.log("PayPal auth debug:", { baseUrl, clientIdLength: clientId.length, secretLength: clientSecret.length, clientIdPrefix: clientId.substring(0, 8) });

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PayPal auth failed: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const { orderId } = await req.json();

    if (!orderId) {
      throw new Error("orderId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const baseUrl = Deno.env.get("PAYPAL_BASE_URL") || "https://api-m.paypal.com";

    // Fetch order with customer data
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, customer:customers(*)")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      throw new Error(`Order not found: ${orderError?.message || "not found"}`);
    }

    // Calculate total with discount
    const products = order.products as Array<{ price: number; quantity: number; title: string }>;
    const subtotal = products.reduce((sum: number, p) => sum + p.price * p.quantity, 0);
    
    let discountAmount = 0;
    if (order.discount_type && order.discount_value) {
      discountAmount = order.discount_type === "percentage"
        ? subtotal * (order.discount_value / 100)
        : order.discount_value;
    }
    const totalAmount = Math.round(Math.max(0, subtotal - discountAmount) * 100) / 100;

    // Build PayPal order items
    const items = products.map((p) => ({
      name: p.title.substring(0, 127),
      quantity: String(p.quantity),
      unit_amount: {
        currency_code: "BRL",
        value: p.price.toFixed(2),
      },
      category: "PHYSICAL_GOODS",
    }));

    // Get PayPal access token
    const accessToken = await getPayPalAccessToken();

    // Create PayPal order
    const returnUrl = `${supabaseUrl}/functions/v1/paypal-webhook?action=capture`;
    const cancelUrl = `${req.headers.get("origin") || "https://live-cart-organizer.lovable.app"}/checkout/cancelled`;

    const paypalOrderBody: Record<string, unknown> = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: orderId,
          description: `Pedido #${orderId.substring(0, 8)}`,
          amount: {
            currency_code: "BRL",
            value: totalAmount.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: "BRL",
                value: subtotal.toFixed(2),
              },
              ...(discountAmount > 0
                ? {
                    discount: {
                      currency_code: "BRL",
                      value: discountAmount.toFixed(2),
                    },
                  }
                : {}),
            },
          },
          items,
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            landing_page: "NO_PREFERENCE",
            user_action: "PAY_NOW",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    };

    const paypalResponse = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(paypalOrderBody),
    });

    if (!paypalResponse.ok) {
      const error = await paypalResponse.text();
      console.error("PayPal create order error:", error);
      throw new Error(`PayPal order creation failed: ${paypalResponse.status}`);
    }

    const paypalOrder = await paypalResponse.json();
    console.log("PayPal order created:", paypalOrder.id);

    // Save payment record
    const { error: insertError } = await supabase
      .from("paypal_payments")
      .insert({
        order_id: orderId,
        paypal_order_id: paypalOrder.id,
        amount: totalAmount,
        currency: "BRL",
        status: "created",
      });

    if (insertError) {
      console.error("Error saving paypal payment:", insertError);
    }

    // Find approval link
    const approvalLink = paypalOrder.links?.find(
      (l: { rel: string; href: string }) => l.rel === "payer-action"
    )?.href;

    // Build checkout page URL
    const checkoutPageUrl = `${req.headers.get("origin") || "https://live-cart-organizer.lovable.app"}/checkout/${paypalOrder.id}`;

    return new Response(
      JSON.stringify({
        paypalOrderId: paypalOrder.id,
        approvalUrl: approvalLink,
        checkoutUrl: checkoutPageUrl,
        amount: totalAmount.toFixed(2),
      }),
      {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error creating PayPal order:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      }
    );
  }
});
